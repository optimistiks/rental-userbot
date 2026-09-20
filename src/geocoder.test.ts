import { HttpResponse, delay, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Fetcher } from "./geocoder.js";

import { createGeocoder, precisionForMatchLevel } from "./geocoder.js";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe("precisionForMatchLevel", () => {
  it.each([
    ["building", "building"],
    ["venue", "place"],
    ["street", "street"],
    ["city", "area"],
    ["unknown", "area"],
  ] as const)("maps %s to %s", (matchLevel, precision) => {
    expect.hasAssertions();
    expect(precisionForMatchLevel(matchLevel)).toBe(precision);
  });
});

describe("createGeocoder", () => {
  it("sends the LocationIQ query and maps results to the tool shape", async () => {
    expect.hasAssertions();
    server.use(
      http.get("https://geocoder.test/v1/search", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("key")).toBe("secret-token");
        expect(url.searchParams.get("q")).toBe("Gorgasali 33, Batumi");
        expect(url.searchParams.get("countrycodes")).toBe("ge");
        expect(url.searchParams.get("format")).toBe("json");
        expect(url.searchParams.get("limit")).toBe("3");
        expect(url.searchParams.get("matchquality")).toBe("1");

        return HttpResponse.json([
          {
            display_name: "Gorgasali 33, Batumi",
            lat: "41.6481086",
            lon: "41.6393883",
            matchquality: { matchlevel: "building" },
          },
          {
            display_name: "Gorgasali Street, Batumi",
            lat: "41.649",
            lon: "41.64",
            matchquality: { matchlevel: "street" },
          },
        ]);
      }),
    );

    const geocoder = createGeocoder({
      token: "secret-token",
      url: "https://geocoder.test/v1/search",
    });

    await expect(geocoder.geocode("Gorgasali 33")).resolves.toStrictEqual({
      results: [
        {
          label: "Gorgasali 33, Batumi",
          lat: 41.6481086,
          lon: 41.6393883,
          precision: "building",
        },
        {
          label: "Gorgasali Street, Batumi",
          lat: 41.649,
          lon: 41.64,
          precision: "street",
        },
      ],
    });
  });

  it.each([
    ["venue", "place"],
    ["street", "street"],
    ["city", "area"],
  ] as const)("reports %s precision as %s", async (matchLevel, precision) => {
    expect.hasAssertions();
    server.use(
      http.get("https://geocoder.test/v1/search", () =>
        HttpResponse.json([
          {
            display_name: "Batumi",
            lat: "41.64",
            lon: "41.62",
            matchquality: { matchlevel: matchLevel },
          },
        ]),
      ),
    );

    const geocoder = createGeocoder({
      token: "secret-token",
      url: "https://geocoder.test/v1/search",
    });

    await expect(geocoder.geocode("some place")).resolves.toStrictEqual({
      results: [{ label: "Batumi", lat: 41.64, lon: 41.62, precision }],
    });
  });

  it("returns no results for a LocationIQ 404 without exposing the request URL", async () => {
    expect.hasAssertions();
    server.use(
      http.get("https://geocoder.test/v1/search", () =>
        HttpResponse.json({ error: "Unable to geocode" }, { status: 404 }),
      ),
    );

    const geocoder = createGeocoder({
      token: "secret-token",
      url: "https://geocoder.test/v1/search",
    });

    await expect(geocoder.geocode("missing")).resolves.toStrictEqual({ results: [] });
  });

  it("throws a redacted provider error for an unauthorized response", async () => {
    expect.hasAssertions();
    server.use(
      http.get("https://geocoder.test/v1/search", () =>
        HttpResponse.json({ error: "Invalid key" }, { status: 401 }),
      ),
    );

    const geocoder = createGeocoder({
      token: "secret-token",
      url: "https://geocoder.test/v1/search",
    });

    await expect(geocoder.geocode("private")).rejects.toThrow(
      "LocationIQ request failed (401): Invalid key",
    );
    await expect(geocoder.geocode("private")).rejects.not.toThrow("secret-token");
  });

  it("passes an abort signal through to fetch for the tool timeout", async () => {
    expect.hasAssertions();
    let signal: AbortSignal | undefined = undefined;
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      throw new Error("aborted https://geocoder.test/v1/search?key=secret-token");
    });
    const geocoder = createGeocoder(
      { token: "secret-token", url: "https://geocoder.test/v1/search" },
      fetcher,
    );

    await expect(geocoder.geocode("slow", new AbortController().signal)).rejects.toThrow(
      "aborted https://geocoder.test/v1/search?key=[redacted]",
    );
    await expect(geocoder.geocode("slow", new AbortController().signal)).rejects.not.toThrow(
      "secret-token",
    );
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces an aborted delayed request as a provider error", async () => {
    expect.hasAssertions();
    server.use(
      http.get("https://geocoder.test/v1/search", async () => {
        await delay(100);
        return HttpResponse.json([]);
      }),
    );
    const geocoder = createGeocoder({
      token: "secret-token",
      url: "https://geocoder.test/v1/search",
    });
    const controller = new AbortController();
    const request = geocoder.geocode("slow", controller.signal);
    controller.abort();

    await expect(request).rejects.toThrow("LocationIQ request failed");
  });
});
