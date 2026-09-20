import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";
import type { ClientFactory } from "./main.js";
import type { SessionClient, TelegramClientLike } from "./telegram.js";

import { runDaemon, runLogin } from "./main.js";

const loginSettings = { apiHash: "hash", apiId: 123_456 };

function noLock() {
  return {
    release: () => {
      /* Nothing to release in tests. */
    },
  };
}

describe(runLogin, () => {
  it("starts an interactive client without reading daemon settings", async () => {
    expect.hasAssertions();
    const start = vi.fn<SessionClient["start"]>(() => Promise.resolve());
    const destroy = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const makeClient = vi.fn<ClientFactory>(() => ({
      destroy,
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      iterDialogs: async function* () {
        /* No dialogs in this test. */
      },
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
      start,
    }));

    await runLogin(loginSettings, makeClient, noLock());

    expect(makeClient).toHaveBeenCalledWith(loginSettings);
    expect(start).toHaveBeenCalledWith();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe(runDaemon, () => {
  it("connects before checking membership and announcing startup", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(criteriaPath, "Criteria");
    const settings = {
      aiGatewayApiKey: "gateway-key",
      apiHash: "hash",
      apiId: 123_456,
      channelIds: [-1_001_234_567_890],
      criteriaPath,
      geocoderUrl: "http://localhost:1234/search",
      locationIqToken: "locationiq-token",
      modelId: "test/model",
      promptPath: criteriaPath,
      zonePath: join(process.cwd(), "data.example/zone.geojson"),
    } satisfies Settings;
    const events: string[] = [];
    const client = {
      destroy: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      iterDialogs: async function* () {
        events.push("dialogs");
        yield { peer: { type: "chat", chatType: "channel", id: -1_001_234_567_890 } };
      },
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: {
        add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>(() => {
          events.push("stream");
        }),
      },
      sendText: vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve(events.push("send"))),
      start: vi.fn<SessionClient["start"]>(() => Promise.resolve(events.push("start"))),
    };

    await runDaemon(settings, () => client, join(directory, "bot.sqlite"), undefined, noLock());

    expect(events).toStrictEqual(["start", "dialogs", "send", "stream"]);
    expect(client.sendText).toHaveBeenCalledWith("me", "🟢 started, watching 1/1 channels", {
      disableWebPreview: true,
    });
  });

  it("closes the client when startup announcement fails", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(criteriaPath, "Criteria");
    const settings = {
      aiGatewayApiKey: "gateway-key",
      apiHash: "hash",
      apiId: 123_456,
      channelIds: [-1_001_234_567_890],
      criteriaPath,
      geocoderUrl: "http://localhost:1234/search",
      locationIqToken: "locationiq-token",
      modelId: "test/model",
      promptPath: criteriaPath,
      zonePath: join(process.cwd(), "data.example/zone.geojson"),
    } satisfies Settings;
    const client = {
      destroy: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      iterDialogs: async function* () {
        yield { peer: { type: "chat", chatType: "channel", id: -1_001_234_567_890 } };
      },
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
      sendText: vi.fn<TelegramClientLike["sendText"]>(async () => {
        throw new Error("Saved Messages unavailable");
      }),
      start: vi.fn<SessionClient["start"]>(() => Promise.resolve()),
    };

    await expect(
      runDaemon(settings, () => client, join(directory, "bot.sqlite"), undefined, noLock()),
    ).rejects.toThrow("Saved Messages unavailable");
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
