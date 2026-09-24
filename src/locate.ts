import type { Settings } from "./config.js";
import type { Fetcher, GeocodeResponse } from "./geocoder.js";
import type { Zone } from "./zone.js";

import { createGeocoder } from "./geocoder.js";
import { inZone } from "./zone.js";

/** One place the query could mean, and whether it lies in the Zone. */
interface LocatedCandidate {
  inside: boolean;
  label: string;
  lat: number;
  lon: number;
  precision: GeocodeResponse["results"][number]["precision"];
  zone: string | null;
}

interface Locator {
  /** Throws when the geocoder fails, so the agent can see the error and try another spelling. */
  locate: (query: string, zone: Zone, signal?: AbortSignal) => Promise<LocatedCandidate[]>;
}

function createLocator(
  settings: Pick<Settings, "geocoderUrl" | "locationIqToken">,
  fetcher?: Fetcher,
): Locator {
  const geocoder = createGeocoder(settings, fetcher);

  return {
    async locate(query, zone, signal) {
      const { results } = await geocoder.geocode(query, signal);
      return results.map((result) => {
        const status = inZone(zone, { lat: result.lat, lon: result.lon });
        return {
          inside: status.inside,
          label: result.label,
          lat: result.lat,
          lon: result.lon,
          precision: result.precision,
          zone: status.zone,
        };
      });
    },
  };
}

function describeLocated(candidates: readonly LocatedCandidate[]): string {
  if (candidates.length === 0) {
    return "nothing found";
  }

  return candidates
    .map((candidate) => {
      const zone = candidate.inside ? `inside ${candidate.zone ?? "the Zone"}` : "outside";
      return `${candidate.precision} "${candidate.label}" (${candidate.lat.toFixed(4)}, ${candidate.lon.toFixed(4)}) ${zone}`;
    })
    .join("; ");
}

export { type LocatedCandidate, type Locator, createLocator, describeLocated };
