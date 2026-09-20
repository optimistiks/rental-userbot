import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";

import { runDaemon, runLogin } from "./main.js";

const loginSettings = { apiId: 123456, apiHash: "hash" };

function noLock() {
  return { release: () => undefined };
}

describe("runLogin", () => {
  it("starts an interactive client without reading daemon settings", async () => {
    const start = vi.fn(async () => undefined);
    const destroy = vi.fn(async () => undefined);
    const makeClient = vi.fn(() => ({
      start,
      destroy,
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage: { add: vi.fn() },
      onMessageGroup: { add: vi.fn() },
    }));

    await runLogin(loginSettings, makeClient, noLock());

    expect(makeClient).toHaveBeenCalledWith(loginSettings);
    expect(start).toHaveBeenCalledWith();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe("runDaemon", () => {
  it("connects before checking membership and announcing startup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(criteriaPath, "Criteria");
    const settings = {
      apiId: 123456,
      apiHash: "hash",
      channelIds: [-1001234567890],
      aiGatewayApiKey: "gateway-key",
      modelId: "test/model",
      locationIqToken: "locationiq-token",
      geocoderUrl: "http://localhost:1234/search",
      criteriaPath,
      promptPath: criteriaPath,
      zonePath: join(process.cwd(), "data.example/zone.geojson"),
    } satisfies Settings;
    const events: string[] = [];
    const client = {
      start: vi.fn(async () => events.push("start")),
      destroy: vi.fn(async () => undefined),
      sendText: vi.fn(async () => events.push("send")),
      iterDialogs: async function* () {
        events.push("dialogs");
        yield { peer: { type: "chat", chatType: "channel", id: -1001234567890 } };
      },
      downloadAsBuffer: vi.fn(),
      onNewMessage: { add: vi.fn(() => events.push("stream")) },
      onMessageGroup: { add: vi.fn() },
    };

    await runDaemon(settings, () => client, join(directory, "bot.sqlite"), undefined, noLock());

    expect(events).toEqual(["start", "dialogs", "send", "stream"]);
    expect(client.sendText).toHaveBeenCalledWith("me", "🟢 started, watching 1/1 channels", {
      disableWebPreview: true,
    });
  });

  it("closes the client when startup announcement fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(criteriaPath, "Criteria");
    const settings = {
      apiId: 123456,
      apiHash: "hash",
      channelIds: [-1001234567890],
      aiGatewayApiKey: "gateway-key",
      modelId: "test/model",
      locationIqToken: "locationiq-token",
      geocoderUrl: "http://localhost:1234/search",
      criteriaPath,
      promptPath: criteriaPath,
      zonePath: join(process.cwd(), "data.example/zone.geojson"),
    } satisfies Settings;
    const client = {
      start: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
      sendText: vi.fn(async () => {
        throw new Error("Saved Messages unavailable");
      }),
      iterDialogs: async function* () {
        yield { peer: { type: "chat", chatType: "channel", id: -1001234567890 } };
      },
      downloadAsBuffer: vi.fn(),
      onNewMessage: { add: vi.fn() },
      onMessageGroup: { add: vi.fn() },
    };

    await expect(
      runDaemon(settings, () => client, join(directory, "bot.sqlite"), undefined, noLock()),
    ).rejects.toThrow("Saved Messages unavailable");
    expect(client.destroy).toHaveBeenCalledOnce();
  });
});
