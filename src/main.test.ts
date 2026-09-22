import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";
import type { ClientFactory } from "./main.js";
import type { SessionLock } from "./session-lock.js";
import type { SessionClient, TelegramClientLike } from "./telegram.js";

import { runDaemon, runLogin } from "./main.js";

const loginSettings = { apiHash: "hash", apiId: 123_456 };

function noLock(): SessionLock {
  return {
    release: (): void => {
      /* Nothing to release in tests. */
    },
  };
}

describe("runLogin", () => {
  it("starts an interactive client without reading daemon settings", async () => {
    expect.hasAssertions();
    const start = vi.fn<SessionClient["start"]>(() => Promise.resolve());
    const destroy = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const makeClient = vi.fn<ClientFactory>(() => ({
      destroy,
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
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

describe("runDaemon", () => {
  it("connects before announcing startup", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    const channelsPath = path.join(directory, "channels.txt");
    writeFileSync(criteriaPath, "Criteria");
    writeFileSync(channelsPath, "-1001234567890\n");
    const settings = {
      aiGatewayApiKey: "gateway-key",
      apiHash: "hash",
      apiId: 123_456,
      channelsPath,
      criteriaPath,
      geocoderUrl: "http://localhost:1234/search",
      locationIqToken: "locationiq-token",
      mediaResolution: "low",
      modelId: "test/model",
      promptPath: criteriaPath,
      thinkingLevel: "low",
      zonePath: path.join(process.cwd(), "data.example/zone.geojson"),
    } satisfies Settings;
    const events: string[] = [];
    const client = {
      destroy: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: {
        add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>(() => {
          events.push("stream");
        }),
      },
      sendText: vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve(events.push("send"))),
      start: vi.fn<SessionClient["start"]>(() => Promise.resolve(events.push("start"))),
    };

    await runDaemon(
      settings,
      () => client,
      path.join(directory, "bot.sqlite"),
      undefined,
      noLock(),
    );

    expect(events).toStrictEqual(["start", "send", "stream"]);
    expect(client.sendText).toHaveBeenCalledWith(
      "me",
      "#rental_userbot\n🟢 started, watching 1 channel",
      { disableWebPreview: true },
    );
  });

  it("closes the client when startup announcement fails", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    const channelsPath = path.join(directory, "channels.txt");
    writeFileSync(criteriaPath, "Criteria");
    writeFileSync(channelsPath, "-1001234567890\n");
    const settings = {
      aiGatewayApiKey: "gateway-key",
      apiHash: "hash",
      apiId: 123_456,
      channelsPath,
      criteriaPath,
      geocoderUrl: "http://localhost:1234/search",
      locationIqToken: "locationiq-token",
      mediaResolution: "low",
      modelId: "test/model",
      promptPath: criteriaPath,
      thinkingLevel: "low",
      zonePath: path.join(process.cwd(), "data.example/zone.geojson"),
    } satisfies Settings;
    const client = {
      destroy: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
      sendText: vi.fn<TelegramClientLike["sendText"]>(() =>
        Promise.reject(new Error("Saved Messages unavailable")),
      ),
      start: vi.fn<SessionClient["start"]>(() => Promise.resolve()),
    };

    await expect(
      runDaemon(settings, () => client, path.join(directory, "bot.sqlite"), undefined, noLock()),
    ).rejects.toThrow("Saved Messages unavailable");
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
