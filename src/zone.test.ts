import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
  const zonePath = path.join(directory, "zone.geojson");
  writeFileSync(zonePath, JSON.stringify(value));
  return zonePath;
}

describe("readZoneFile", () => {
  it("reads a FeatureCollection with Polygon and MultiPolygon features", () => {
    expect.hasAssertions();
    const path = writeZone({
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

    expect(readZoneFile(path).features).toHaveLength(2);
  });

  it("names a missing, malformed, or empty Zone file", () => {
    expect.hasAssertions();
    const missingPath = path.join(tmpdir(), "missing-rental-zone.geojson");
    expect(() => readZoneFile(missingPath)).toThrow(new RegExp(`Zone file .*${missingPath}`, "u"));

    const malformedPath = path.join(
      mkdtempSync(path.join(tmpdir(), "rental-userbot-")),
      "zone.geojson",
    );
    writeFileSync(malformedPath, "{");
    expect(() => readZoneFile(malformedPath)).toThrow(/Zone file .*valid GeoJSON/u);

    const emptyPath = writeZone({ features: [], type: "FeatureCollection" });
    expect(() => readZoneFile(emptyPath)).toThrow(/Zone file .*Polygon or MultiPolygon/u);

    const pointPath = writeZone({
      features: [
        { geometry: { coordinates: [0, 0], type: "Point" }, properties: {}, type: "Feature" },
      ],
      type: "FeatureCollection",
    });
    expect(() => readZoneFile(pointPath)).toThrow(/Zone file .*Polygon or MultiPolygon/u);

    const openRingPath = writeZone({
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
    expect(() => readZoneFile(openRingPath)).toThrow(/Zone file .*valid GeoJSON/u);

    const mixedInvalidPath = writeZone({
      features: [
        polygon("Valid"),
        { geometry: { type: "Polygon" }, properties: {}, type: "Feature" },
      ],
      type: "FeatureCollection",
    });
    expect(() => readZoneFile(mixedInvalidPath)).toThrow(/Zone file .*invalid feature/u);
  });
});

describe("createZoneChecker", () => {
  it("answers known points from the starting Zone", () => {
    expect.hasAssertions();
    const checker = createZoneChecker(path.join(process.cwd(), "data.example/zone.geojson"));

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
    expect.hasAssertions();
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
