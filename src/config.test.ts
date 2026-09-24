import { describe, expect, it } from "vitest";

import { readLoginSettings, readSettings } from "./config.js";

const validEnvironment = {
  AI_GATEWAY_API_KEY: "gateway-key",
  API_HASH: "hash",
  API_ID: "123456",
  LOCATIONIQ_TOKEN: "locationiq-token",
};

describe("readSettings", () => {
  it("reads only the API settings needed by login", () => {
    expect.hasAssertions();
    expect(
      readLoginSettings({
        API_HASH: "hash",
        API_ID: "123456",
      }),
    ).toStrictEqual({ apiHash: "hash", apiId: 123_456 });
  });

  it("allows optional settings to override defaults", () => {
    expect.hasAssertions();
    expect(
      readSettings({
        ...validEnvironment,
        CHANNELS_PATH: "/tmp/channels.txt",
        CRITERIA_PATH: "/tmp/criteria.md",
        EVALUATION_CONCURRENCY: "8",
        GEOCODER_URL: "http://localhost:1234/search",
        MEDIA_RESOLUTION: "medium",
        MODEL_ID: "test/model",
        PROMPT_PATH: "/tmp/prompt.md",
        THINKING_LEVEL: "high",
        ZONE_PATH: "/tmp/zone.geojson",
      }),
    ).toMatchObject({
      channelsPath: "/tmp/channels.txt",
      criteriaPath: "/tmp/criteria.md",
      evaluationConcurrency: 8,
      geocoderUrl: "http://localhost:1234/search",
      mediaResolution: "medium",
      modelId: "test/model",
      promptPath: "/tmp/prompt.md",
      thinkingLevel: "high",
      zonePath: "/tmp/zone.geojson",
    });
  });

  it.each(["API_ID", "API_HASH", "AI_GATEWAY_API_KEY", "LOCATIONIQ_TOKEN"])(
    "names missing required setting %s",
    (name) => {
      expect.hasAssertions();
      const { [name as keyof typeof validEnvironment]: _omitted, ...environment } =
        validEnvironment;

      expect(() => readSettings(environment)).toThrow(new RegExp(`${name} is required`, "u"));
    },
  );

  it("rejects malformed API_ID", () => {
    expect.hasAssertions();
    expect(() => readSettings({ ...validEnvironment, API_ID: "not-a-number" })).toThrow(/API_ID/u);
  });

  it.each(["0", "-1", "1.5", "three", "9007199254740993"])(
    "rejects EVALUATION_CONCURRENCY %s",
    (value) => {
      expect.hasAssertions();
      expect(() => readSettings({ ...validEnvironment, EVALUATION_CONCURRENCY: value })).toThrow(
        /EVALUATION_CONCURRENCY must be a positive integer/u,
      );
    },
  );

  it.each([
    ["MEDIA_RESOLUTION", "ultra"],
    ["THINKING_LEVEL", "minimal"],
  ])("rejects unsupported %s", (name, value) => {
    expect.hasAssertions();
    expect(() => readSettings({ ...validEnvironment, [name]: value })).toThrow(
      new RegExp(`${name} must be one of`, "u"),
    );
  });
});
