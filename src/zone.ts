import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { readFileSync } from "node:fs";

import { errorMessage } from "./errors.js";

interface ZoneGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

interface ZoneFeature {
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: ZoneGeometry;
}

interface ZoneFile {
  type: "FeatureCollection";
  features: ZoneFeature[];
}

interface ZoneResult {
  inside: boolean;
  zone: string | null;
}

/** A location on the map. GeoJSON's own [lon, lat] order is confined to toPosition. */
interface Point {
  lat: number;
  lon: number;
}

interface ZoneChecker {
  inZone: (point: Point) => ZoneResult;
}

function readZoneFile(zonePath: string): ZoneFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(zonePath, "utf8"));
  } catch (error) {
    throw new Error(`Zone file "${zonePath}" is not valid GeoJSON: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  const features = zoneFeatures(parsed, zonePath);
  if (features.length === 0) {
    throw new Error(
      `Zone file "${zonePath}" must contain at least one Polygon or MultiPolygon feature`,
    );
  }

  return { features, type: "FeatureCollection" };
}

function createZoneChecker(zonePath: string): ZoneChecker {
  return {
    inZone(point) {
      const zone = readZoneFile(zonePath);

      for (const feature of zone.features) {
        if (
          booleanPointInPolygon(
            toPosition(point),
            feature as Parameters<typeof booleanPointInPolygon>[1],
          )
        ) {
          return {
            inside: true,
            zone: featureName(feature),
          };
        }
      }

      return { inside: false, zone: null };
    },
  };
}

function zoneFeatures(value: unknown, zonePath: string): ZoneFeature[] {
  if (!isRecord(value)) {
    return [];
  }

  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    const features: ZoneFeature[] = [];
    for (const feature of value.features) {
      if (!isGeoJsonFeature(feature)) {
        throw new Error(
          `Zone file "${zonePath}" is not valid GeoJSON: contains an invalid feature`,
        );
      }
      if (isZoneFeature(feature)) {
        features.push(feature);
      }
    }
    return features;
  }

  if (isZoneFeature(value)) {
    return [value];
  }

  return [];
}

function isZoneFeature(value: unknown): value is ZoneFeature {
  if (!isRecord(value) || value.type !== "Feature" || !isZoneGeometry(value.geometry)) {
    return false;
  }

  return value.properties === null || isRecord(value.properties);
}

function isGeoJsonFeature(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "Feature") {
    return false;
  }

  if (value.properties !== null && !isRecord(value.properties)) {
    return false;
  }

  if (value.geometry === null) {
    return true;
  }

  if (!isRecord(value.geometry) || typeof value.geometry.type !== "string") {
    return false;
  }

  if (value.geometry.type === "Polygon" || value.geometry.type === "MultiPolygon") {
    return isZoneGeometry(value.geometry);
  }

  if (value.geometry.type === "GeometryCollection") {
    return Array.isArray(value.geometry.geometries);
  }

  return Array.isArray(value.geometry.coordinates);
}

function isZoneGeometry(value: unknown): value is ZoneGeometry {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) {
    return false;
  }

  if (value.type === "Polygon") {
    return isPolygonCoordinates(value.coordinates);
  }

  if (value.type === "MultiPolygon") {
    return (
      Array.isArray(value.coordinates) &&
      value.coordinates.length > 0 &&
      value.coordinates.every(isPolygonCoordinates)
    );
  }

  return false;
}

function isPolygonCoordinates(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isLinearRing);
}

function isLinearRing(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 4) {
    return false;
  }

  const [first] = value;
  const last = value.at(-1);
  return (
    value.every(isPosition) &&
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function toPosition(point: Point): [number, number] {
  return [point.lon, point.lat];
}

export {
  type ZoneFeature,
  type ZoneFile,
  type ZoneResult,
  type Point,
  type ZoneChecker,
  readZoneFile,
  createZoneChecker,
};
