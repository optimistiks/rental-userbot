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
  geometry: { coordinates: [coordinates], type: "Polygon" },
  properties: { name },
  type: "Feature",
});

function writeZone(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
  const path = join(directory, "zone.geojson");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe(readZoneFile, () => {
  it("reads a FeatureCollection with Polygon and MultiPolygon features", () => {
    const path = writeZone({
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
      type: "FeatureCollection",
    });

    expect(readZoneFile(path).features).toHaveLength(2);
  });

  it("names a missing, malformed, or empty Zone file", () => {
    const missingPath = join(tmpdir(), "missing-rental-zone.geojson");
    expect(() => readZoneFile(missingPath)).toThrow(new RegExp(`Zone file .*${missingPath}`, "u"));

    const malformedPath = join(mkdtempSync(join(tmpdir(), "rental-userbot-")), "zone.geojson");
    writeFileSync(malformedPath, "{");
    expect(() => readZoneFile(malformedPath)).toThrow(/Zone file .*valid GeoJSON/u);

    const emptyPath = writeZone({ features: [], type: "FeatureCollection" });
    expect(() => readZoneFile(emptyPath)).toThrow(/Zone file .*Polygon or MultiPolygon/u);

    const pointPath = writeZone({
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
      type: "FeatureCollection",
    });
    expect(() => readZoneFile(pointPath)).toThrow(/Zone file .*Polygon or MultiPolygon/u);

    const openRingPath = writeZone({
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
      type: "FeatureCollection",
    });
    expect(() => readZoneFile(openRingPath)).toThrow(/Zone file .*valid GeoJSON/u);

    const mixedInvalidPath = writeZone({
      features: [
        polygon("Valid"),
        { type: "Feature", properties: {}, geometry: { type: "Polygon" } },
      ],
      type: "FeatureCollection",
    });
    expect(() => readZoneFile(mixedInvalidPath)).toThrow(/Zone file .*invalid feature/u);
  });
});

describe(createZoneChecker, () => {
  it("answers known points from the starting Zone", () => {
    const checker = createZoneChecker(join(process.cwd(), "data.example/zone.geojson"));

    expect(checker.inZone({ lat: 41.6437281, lon: 41.6322006 })).toStrictEqual({
      inside: true,
      zone: "Rustaveli",
    });
    expect(checker.inZone({ lat: 41.6400004, lon: 41.622037 })).toStrictEqual({
      inside: false,
      zone: null,
    });
  });

  it("re-reads the Zone file on every call", () => {
    const path = writeZone({ features: [polygon("First")], type: "FeatureCollection" });
    const checker = createZoneChecker(path);

    expect(checker.inZone({ lat: 0.5, lon: 0.5 })).toStrictEqual({ inside: true, zone: "First" });
    writeFileSync(
      path,
      JSON.stringify({
        features: [
          polygon("Second", [
            [10, 10],
            [11, 10],
            [11, 11],
            [10, 11],
            [10, 10],
          ]),
        ],
        type: "FeatureCollection",
      }),
    );

    expect(checker.inZone({ lat: 0.5, lon: 0.5 })).toStrictEqual({ inside: false, zone: null });
    expect(checker.inZone({ lat: 10.5, lon: 10.5 })).toStrictEqual({
      inside: true,
      zone: "Second",
    });
  });
});
