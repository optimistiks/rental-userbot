import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ZoneFeature } from "./zone.js";

import { inZone, parseZone } from "./zone.js";

const polygon = (
  name: string,
  coordinates = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ],
): ZoneFeature => ({
  geometry: { coordinates: [coordinates], type: "Polygon" },
  properties: { name },
  type: "Feature",
});

function parse(value: unknown): ReturnType<typeof parseZone> {
  return parseZone(JSON.stringify(value));
}

describe("parseZone", () => {
  it("reads a FeatureCollection with Polygon and MultiPolygon features", () => {
    expect.hasAssertions();
    const zone = parse({
      features: [
        polygon("Old Batumi"),
        {
          geometry: {
            coordinates: [
              [
                [
                  [2, 2],
                  [3, 2],
                  [3, 3],
                  [2, 3],
                  [2, 2],
                ],
              ],
            ],
            type: "MultiPolygon",
          },
          properties: { name: "Rustaveli" },
          type: "Feature",
        },
      ],
      type: "FeatureCollection",
    });

    expect(zone).toHaveLength(2);
  });

  it("rejects malformed, empty, or invalid outlines", () => {
    expect.hasAssertions();
    expect(() => parseZone("{")).toThrow(/valid GeoJSON/u);

    const empty = (): unknown => parse({ features: [], type: "FeatureCollection" });
    expect(empty).toThrow(/Polygon or MultiPolygon/u);

    const point = (): unknown =>
      parse({
        features: [
          { geometry: { coordinates: [0, 0], type: "Point" }, properties: {}, type: "Feature" },
        ],
        type: "FeatureCollection",
      });
    expect(point).toThrow(/Polygon or MultiPolygon/u);

    const openRing = (): unknown =>
      parse({
        features: [
          {
            geometry: {
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                ],
              ],
              type: "Polygon",
            },
            properties: {},
            type: "Feature",
          },
        ],
        type: "FeatureCollection",
      });
    expect(openRing).toThrow(/valid GeoJSON/u);

    const mixedInvalid = (): unknown =>
      parse({
        features: [
          polygon("Valid"),
          { geometry: { type: "Polygon" }, properties: {}, type: "Feature" },
        ],
        type: "FeatureCollection",
      });
    expect(mixedInvalid).toThrow(/invalid feature/u);
  });
});

describe("inZone", () => {
  it("answers known points from the starting Zone", () => {
    expect.hasAssertions();
    const zonePath = path.join(process.cwd(), "data.example/zone.geojson");
    const zone = parseZone(readFileSync(zonePath, "utf8"));

    expect(inZone(zone, { lat: 41.6437281, lon: 41.6322006 })).toStrictEqual({
      inside: true,
      zone: "Rustaveli",
    });
    expect(inZone(zone, { lat: 41.6400004, lon: 41.622037 })).toStrictEqual({
      inside: false,
      zone: null,
    });
  });
});
