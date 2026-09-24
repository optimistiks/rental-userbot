import { describe, expect, it, vi } from "vitest";

import type { Fetcher } from "./geocoder.js";

import { createLocator, describeLocated } from "./locate.js";
import { zoneCollection } from "./test-support.js";
import { parseZone } from "./zone.js";

const settings = {
  geocoderUrl: "https://geocoder.test/v1/search",
  locationIqToken: "secret-token",
};

/** Old Batumi around Gorgasali 33 only, in GeoJSON's [lon, lat] order. */
const zone = parseZone(
  JSON.stringify(
    zoneCollection("Old Batumi", [
      [41.63, 41.645],
      [41.645, 41.645],
      [41.645, 41.655],
      [41.63, 41.655],
      [41.63, 41.645],
    ]),
  ),
);

function answering(body: unknown): Fetcher {
  return vi.fn<Fetcher>(() => Promise.resolve(Response.json(body)));
}

describe("locate in Zone", () => {
  it("annotates every geocoder candidate with its Zone status", async () => {
    expect.hasAssertions();
    const locator = createLocator(
      settings,
      answering([
        {
          display_name: "Gorgasali 33, Batumi",
          lat: "41.6481086",
          lon: "41.6393883",
          matchquality: { matchlevel: "building" },
        },
        {
          display_name: "Gorgasali Street, Batumi",
          lat: "41.641",
          lon: "41.62",
          matchquality: { matchlevel: "street" },
        },
      ]),
    );

    await expect(locator.locate("Gorgasali 33", zone)).resolves.toStrictEqual([
      {
        inside: true,
        label: "Gorgasali 33, Batumi",
        lat: 41.6481086,
        lon: 41.6393883,
        precision: "building",
        zone: "Old Batumi",
      },
      {
        inside: false,
        label: "Gorgasali Street, Batumi",
        lat: 41.641,
        lon: 41.62,
        precision: "street",
        zone: null,
      },
    ]);
  });

  it("describes what it found in one line", () => {
    expect.hasAssertions();

    expect(describeLocated([])).toBe("nothing found");
    expect(
      describeLocated([
        {
          inside: true,
          label: "Gorgasali 33, Batumi",
          lat: 41.6481086,
          lon: 41.6393883,
          precision: "building",
          zone: "Old Batumi",
        },
        {
          inside: false,
          label: "Gorgasali Street, Batumi",
          lat: 41.641,
          lon: 41.62,
          precision: "street",
          zone: null,
        },
      ]),
    ).toBe(
      'building "Gorgasali 33, Batumi" (41.6481, 41.6394) inside Old Batumi; street "Gorgasali Street, Batumi" (41.6410, 41.6200) outside',
    );
  });
});
