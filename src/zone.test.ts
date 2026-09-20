import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createZoneChecker, readZoneFile } from "./zone.js";

const polygon = (
  name: string,
  coordinates = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ],
) => ({
  type: "Feature",
  properties: { name },
  geometry: { type: "Polygon", coordinates: [coordinates] },
});

function writeZone(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
  const path = join(directory, "zone.geojson");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("readZoneFile", () => {
  it("reads a FeatureCollection with Polygon and MultiPolygon features", () => {
    const path = writeZone({
      type: "FeatureCollection",
      features: [
        polygon("Old Batumi"),
        {
          type: "Feature",
          properties: { name: "Rustaveli" },
          geometry: {
            type: "MultiPolygon",
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
          },
        },
      ],
    });

    expect(readZoneFile(path).features).toHaveLength(2);
  });

  it("names a missing, malformed, or empty Zone file", () => {
    const missingPath = join(tmpdir(), "missing-rental-zone.geojson");
    expect(() => readZoneFile(missingPath)).toThrowError(new RegExp(`Zone file .*${missingPath}`));

    const malformedPath = join(mkdtempSync(join(tmpdir(), "rental-userbot-")), "zone.geojson");
    writeFileSync(malformedPath, "{");
    expect(() => readZoneFile(malformedPath)).toThrowError(/Zone file .*valid GeoJSON/);

    const emptyPath = writeZone({ type: "FeatureCollection", features: [] });
    expect(() => readZoneFile(emptyPath)).toThrowError(/Zone file .*Polygon or MultiPolygon/);

    const pointPath = writeZone({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
    });
    expect(() => readZoneFile(pointPath)).toThrowError(/Zone file .*Polygon or MultiPolygon/);

    const openRingPath = writeZone({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
            ],
          },
        },
      ],
    });
    expect(() => readZoneFile(openRingPath)).toThrowError(/Zone file .*valid GeoJSON/);

    const mixedInvalidPath = writeZone({
      type: "FeatureCollection",
      features: [
        polygon("Valid"),
        { type: "Feature", properties: {}, geometry: { type: "Polygon" } },
      ],
    });
    expect(() => readZoneFile(mixedInvalidPath)).toThrowError(/Zone file .*invalid feature/);
  });
});

describe("createZoneChecker", () => {
  it("answers known points from the starting Zone", () => {
    const checker = createZoneChecker(join(process.cwd(), "data.example/zone.geojson"));

    expect(checker.inZone({ lat: 41.6437281, lon: 41.6322006 })).toEqual({
      inside: true,
      zone: "Rustaveli",
    });
    expect(checker.inZone({ lat: 41.6400004, lon: 41.622037 })).toEqual({
      inside: false,
      zone: null,
    });
  });

  it("re-reads the Zone file on every call", () => {
    const path = writeZone({ type: "FeatureCollection", features: [polygon("First")] });
    const checker = createZoneChecker(path);

    expect(checker.inZone({ lat: 0.5, lon: 0.5 })).toEqual({ inside: true, zone: "First" });
    writeFileSync(
      path,
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          polygon("Second", [
            [10, 10],
            [11, 10],
            [11, 11],
            [10, 11],
            [10, 10],
          ]),
        ],
      }),
    );

    expect(checker.inZone({ lat: 0.5, lon: 0.5 })).toEqual({ inside: false, zone: null });
    expect(checker.inZone({ lat: 10.5, lon: 10.5 })).toEqual({ inside: true, zone: "Second" });
  });
});
