// Sentry auto-instruments outgoing requests, and the LocationIQ URL carries the
// Token in its query string, so this request stays out of the trace entirely.
import { suppressTracing } from "@sentry/node";

import type { Settings } from "./config.js";

import { errorMessage } from "./errors.js";

type GeocodePrecision = "building" | "place" | "street" | "area";

interface GeocodeResult {
  precision: GeocodePrecision;
  lat: number;
  lon: number;
  label: string;
}

interface GeocodeResponse {
  results: GeocodeResult[];
}

interface Geocoder {
  geocode: (query: string, signal?: AbortSignal) => Promise<GeocodeResponse>;
}

interface LocationIqResult {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
  matchquality?: {
    matchlevel?: unknown;
  };
}

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/* `matchlevel` and not the better-named `matchcode`: LocationIQ reports how good the
   match was, not how precise it is. A house number that does not exist comes back as
   matchlevel "street" with matchcode "exact", and a misspelled street comes back HTTP
   200 at matchlevel "city" — the Batumi centroid — rather than as a miss. Only the
   level says whether a point is worth checking against the Zone. Anything not listed
   here is an "area". */
const PRECISION_BY_MATCH_LEVEL = new Map<unknown, GeocodePrecision>([
  ["building", "building"],
  ["venue", "place"],
  ["street", "street"],
]);

function createGeocoder(
  settings: Pick<Settings, "geocoderUrl" | "locationIqToken">,
  fetcher: Fetcher = fetch,
): Geocoder {
  const token = settings.locationIqToken;

  return {
    async geocode(query, signal) {
      const url = new URL(settings.geocoderUrl);
      url.searchParams.set("key", token);
      url.searchParams.set("q", `${query.trim()}, Batumi`);
      url.searchParams.set("countrycodes", "ge");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "3");
      url.searchParams.set("matchquality", "1");

      let response: Response;
      try {
        response = await suppressTracing(() => fetcher(url, { signal }));
      } catch (error) {
        throw new GeocoderError(`LocationIQ request failed: ${redact(errorMessage(error), token)}`);
      }

      if (response.status === 404) {
        return { results: [] };
      }

      if (!response.ok) {
        throw new GeocoderError(
          `LocationIQ request failed (${response.status}): ${await responseError(response, token)}`,
        );
      }

      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        throw new GeocoderError("LocationIQ request failed: response was not a result list");
      }

      return { results: body.slice(0, 3).map((entry) => toGeocodeResult(entry)) };
    },
  };
}

/* A named class, not a bare Error: the original error is deliberately not kept as the
   cause, because its message can carry the token. */
class GeocoderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GeocoderError";
  }
}

function toGeocodeResult(value: unknown): GeocodeResult {
  /* Parsing a third-party response: the shape is checked by the caller. */
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const result = value as LocationIqResult;
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  const label = result.display_name;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof label !== "string") {
    throw new GeocoderError("LocationIQ request failed: invalid result");
  }

  return {
    label,
    lat,
    lon,
    precision: PRECISION_BY_MATCH_LEVEL.get(result.matchquality?.matchlevel) ?? "area",
  };
}

async function responseError(response: Response, token: string): Promise<string> {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? redact(body.error, token) : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function redact(message: string, token: string): string {
  return message.replaceAll(token, "[redacted]");
}

export { type GeocodeResponse, type Fetcher, createGeocoder };
