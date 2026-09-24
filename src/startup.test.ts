import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";
import type { Telegram } from "./telegram.js";

import { announceStartup, initializeStartup } from "./startup.js";

const settings = (
  criteriaPath: string,
  promptPath = criteriaPath,
  zonePath = path.join(process.cwd(), "data.example/zone.geojson"),
  channelsPath = path.join(process.cwd(), "data.example/channels.txt"),
): Settings => ({
  aiGatewayApiKey: "gateway-key",
  apiHash: "hash",
  apiId: 123_456,
  channelsPath,
  criteriaPath,
  evaluationConcurrency: 1,
  geocoderUrl: "http://localhost:1234/search",
  locationIqToken: "locationiq-token",
  mediaResolution: "low",
  modelId: "test/model",
  promptPath,
  thinkingLevel: "low",
  zonePath,
});

describe("initializeStartup", () => {
  it("checks the Criteria file and initializes a SQLite Dedupe Store", () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(criteriaPath, "Criteria text");

    const resources = initializeStartup(settings(criteriaPath), ":memory:");

    expect(resources.dedupeStore.isProcessed("chat:1")).toBe(false);
    resources.dedupeStore.close();
  });

  it("fails before opening the database when Criteria cannot be read", () => {
    expect.hasAssertions();
    expect(() => initializeStartup(settings("/missing/criteria.md"), ":memory:")).toThrow(
      /Criteria file/u,
    );
  });

  it("names the Prompt file when it cannot be read", () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    const promptPath = path.join(directory, "prompt.md");
    writeFileSync(criteriaPath, "Criteria text");

    expect(() => initializeStartup(settings(criteriaPath, promptPath), ":memory:")).toThrow(
      new RegExp(`Prompt file .*${promptPath}`, "u"),
    );
  });

  it("names the Zone file when it cannot be read", () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    const promptPath = path.join(directory, "prompt.md");
    const zonePath = path.join(directory, "zone.geojson");
    writeFileSync(criteriaPath, "Criteria text");
    writeFileSync(promptPath, "Prompt text");

    expect(() =>
      initializeStartup(settings(criteriaPath, promptPath, zonePath), ":memory:"),
    ).toThrow(new RegExp(`Zone file .*${zonePath}`, "u"));
  });

  it("names the Watchlist file when it is missing", () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    const promptPath = path.join(directory, "prompt.md");
    const zonePath = path.join(process.cwd(), "data.example/zone.geojson");
    const channelsPath = path.join(directory, "channels.txt");
    writeFileSync(criteriaPath, "Criteria text");
    writeFileSync(promptPath, "Prompt text");

    expect(() =>
      initializeStartup(settings(criteriaPath, promptPath, zonePath, channelsPath), ":memory:"),
    ).toThrow(new RegExp(`Watchlist file .*${channelsPath}`, "u"));
  });
});

describe("announceStartup", () => {
  it("sends a startup Notice for the Watchlist size, not join state", async () => {
    expect.hasAssertions();
    const telegram = {
      sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await announceStartup(telegram, [-1_001_234_567_890, -1_009_876_543_210]);

    expect(log).toHaveBeenCalledWith("startup: 🟢 started, watching 2 channels");
    expect(telegram.sendToMe).toHaveBeenCalledWith("🟢 started, watching 2 channels");
    log.mockRestore();
  });

  it("says watching 0 channels when the Watchlist is empty", async () => {
    expect.hasAssertions();
    const telegram = {
      sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()),
    };

    await announceStartup(telegram, []);

    expect(telegram.sendToMe).toHaveBeenCalledWith("🟢 started, watching 0 channels");
  });
});
