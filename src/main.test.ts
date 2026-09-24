import { rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ClientFactory } from "./main.js";
import type { SessionLock } from "./session-lock.js";
import type { SessionClient, TelegramClientLike } from "./telegram.js";

import { runDaemon, runLogin } from "./main.js";
import { createSentryReporter } from "./sentry.js";
import { ownerFiles, quiet, temporaryDirectory, testSettings } from "./test-support.js";

function noLock(): SessionLock {
  return {
    release: (): void => {
      /* Nothing to release in tests. */
    },
  };
}

type FakeClient = ReturnType<ClientFactory> & {
  destroy: ReturnType<typeof vi.fn<() => Promise<void>>>;
  sendText: ReturnType<typeof vi.fn<TelegramClientLike["sendText"]>>;
  start: ReturnType<typeof vi.fn<SessionClient["start"]>>;
};

function fakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    destroy: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
    onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
    onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
    sendText: vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve()),
    start: vi.fn<SessionClient["start"]>(() => Promise.resolve()),
    ...overrides,
  };
}

/** Starts the daemon over fresh owner files, a fresh database and `client`. */
function startDaemon(client: FakeClient, settings = testSettings()): Promise<void> {
  return runDaemon(
    settings,
    createSentryReporter(),
    () => client,
    path.join(temporaryDirectory(), "bot.sqlite"),
    noLock(),
  );
}

describe("runLogin", () => {
  it("starts an interactive client without reading daemon settings", async () => {
    expect.hasAssertions();
    const loginSettings = { apiHash: "hash", apiId: 123_456 };
    const client = fakeClient();
    const makeClient = vi.fn<ClientFactory>(() => client);

    await runLogin(loginSettings, makeClient, noLock());

    expect(makeClient).toHaveBeenCalledWith(loginSettings);
    expect(client.start).toHaveBeenCalledWith();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("runDaemon", () => {
  it("connects before announcing startup", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const events: string[] = [];
    const client = fakeClient({
      onNewMessage: {
        add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>(() => {
          events.push("stream");
        }),
      },
      sendText: vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve(events.push("send"))),
      start: vi.fn<SessionClient["start"]>(() => Promise.resolve(events.push("start"))),
    });

    await startDaemon(client, testSettings(ownerFiles("-1001234567890\n-1009876543210\n")));

    expect(events).toStrictEqual(["start", "send", "stream"]);
    expect(client.sendText).toHaveBeenCalledWith(
      "me",
      "#rental_userbot\n🟢 started, watching 2 channels",
      { disableWebPreview: true },
    );
    expect(log).toHaveBeenCalledWith("startup: 🟢 started, watching 2 channels");
  });

  it("refuses interactive prompts when the session needs a login", async () => {
    expect.hasAssertions();
    const client = fakeClient({
      start: vi.fn<SessionClient["start"]>(async (params) => {
        await params?.phone();
      }),
    });

    await expect(startDaemon(client)).rejects.toThrow("run login first");
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("closes the client when startup announcement fails", async () => {
    expect.hasAssertions();
    quiet("log");
    const client = fakeClient({
      sendText: vi.fn<TelegramClientLike["sendText"]>(() =>
        Promise.reject(new Error("Saved Messages unavailable")),
      ),
    });

    await expect(startDaemon(client)).rejects.toThrow("Saved Messages unavailable");
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Criteria", "criteriaPath"],
    ["Prompt", "promptPath"],
    ["Zone", "zonePath"],
    ["Watchlist", "channelsPath"],
  ] as const)("names the %s file when it cannot be read", async (label, file) => {
    expect.hasAssertions();
    const files = ownerFiles();
    rmSync(files[file]);
    const client = fakeClient();

    await expect(startDaemon(client, testSettings(files))).rejects.toThrow(
      new RegExp(`${label} file .*${files[file]}`, "u"),
    );
    expect(client.start).not.toHaveBeenCalled();
  });
});
