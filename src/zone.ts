import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

import { errorMessage, isRecord } from "./errors.js";

interface ZoneGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

interface ZoneFeature {
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: ZoneGeometry;
}

interface ZoneResult {
  inside: boolean;
  zone: string | null;
}

/** A location on the map. GeoJSON's own [lon, lat] order is confined to inZone. */
interface Point {
  lat: number;
  lon: number;
}

/** The owner's outline: at least one Polygon or MultiPolygon feature. */
type Zone = readonly ZoneFeature[];

/** Errors read as the rest of a sentence that starts with the file's name. */
function parseZone(text: string): Zone {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`is not valid GeoJSON: ${errorMessage(error)}`, { cause: error });
  }

  const features = zoneFeatures(parsed);
  if (features.length === 0) {
    throw new Error("must contain at least one Polygon or MultiPolygon feature");
  }

  return features;
}

function inZone(zone: Zone, point: Point): ZoneResult {
  const feature = zone.find((candidate) =>
    booleanPointInPolygon(
      [point.lon, point.lat],
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      candidate as Parameters<typeof booleanPointInPolygon>[1],
    ),
  );

  return feature === undefined
    ? { inside: false, zone: null }
    : { inside: true, zone: featureName(feature) };
}

/** Only Polygon and MultiPolygon features are checked; any other feature is ignored. */
function zoneFeatures(value: unknown): ZoneFeature[] {
  const candidates: unknown[] =
    isRecord(value) && value.type === "FeatureCollection" && Array.isArray(value.features)
      ? value.features
      : [value];

  return candidates.filter((candidate): candidate is ZoneFeature => {
    if (!isRecord(candidate) || !isRecord(candidate.geometry)) {
      return false;
    }
    const { type } = candidate.geometry;
    if (type !== "Polygon" && type !== "MultiPolygon") {
      return false;
    }
    if (!isZoneFeature(candidate)) {
      throw new Error("is not valid GeoJSON: contains an invalid feature");
    }
    return true;
  });
}

function isZoneFeature(value: Record<string, unknown>): boolean {
  return (
    value.type === "Feature" &&
    (value.properties === null || isRecord(value.properties)) &&
    isZoneGeometry(value.geometry)
  );
}

function isZoneGeometry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.type === "Polygon") {
    return isPolygonCoordinates(value.coordinates);
  }

  return (
    Array.isArray(value.coordinates) &&
    value.coordinates.length > 0 &&
    value.coordinates.every(isPolygonCoordinates)
  );
}

function isPolygonCoordinates(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((ring) => isLinearRing(ring));
}

function isLinearRing(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 4) {
    return false;
  }

  const ring = value as unknown[];
  const [first] = ring;
  const last = ring.at(-1);
  return (
    ring.every((position) => isPosition(position)) &&
    Array.isArray(first) &&
    Array.isArray(last) &&
    first[0] === last[0] &&
    first[1] === last[1]
  );
}

function isPosition(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function featureName(feature: ZoneFeature): string | null {
  const name = feature.properties?.name;
  return typeof name === "string" ? name : null;
}

export { type Zone, type ZoneFeature, type ZoneResult, type Point, parseZone, inZone, featureName };
