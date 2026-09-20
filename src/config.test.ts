import { describe, expect, it } from "vitest";

import {
  CHANNELS_PATH,
  CRITERIA_PATH,
  GEOCODER_URL,
  MODEL_ID,
  PROMPT_PATH,
  ZONE_PATH,
  readLoginSettings,
  readSettings,
} from "./config.js";

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

  it("reads required settings and applies defaults", () => {
    expect.hasAssertions();
    expect(readSettings(validEnvironment)).toStrictEqual({
      aiGatewayApiKey: "gateway-key",
      apiHash: "hash",
      apiId: 123_456,
      channelsPath: CHANNELS_PATH,
      criteriaPath: CRITERIA_PATH,
      geocoderUrl: GEOCODER_URL,
      locationIqToken: "locationiq-token",
      modelId: MODEL_ID,
      promptPath: PROMPT_PATH,
      zonePath: ZONE_PATH,
    });
  });

  it("allows optional settings to override defaults", () => {
    expect.hasAssertions();
    expect(
      readSettings({
        ...validEnvironment,
        CHANNELS_PATH: "/tmp/channels.txt",
        CRITERIA_PATH: "/tmp/criteria.md",
        GEOCODER_URL: "http://localhost:1234/search",
        MODEL_ID: "test/model",
        PROMPT_PATH: "/tmp/prompt.md",
        ZONE_PATH: "/tmp/zone.geojson",
      }),
    ).toMatchObject({
      channelsPath: "/tmp/channels.txt",
      criteriaPath: "/tmp/criteria.md",
      geocoderUrl: "http://localhost:1234/search",
      modelId: "test/model",
      promptPath: "/tmp/prompt.md",
      zonePath: "/tmp/zone.geojson",
    });
  });

  it("keeps Sentry disabled unless SENTRY_DSN is set", () => {
    expect.hasAssertions();
    expect(readSettings(validEnvironment).sentryDsn).toBeUndefined();
    expect(
      readSettings({ ...validEnvironment, SENTRY_DSN: "https://public@example.com/1" }).sentryDsn,
    ).toBe("https://public@example.com/1");
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
});
