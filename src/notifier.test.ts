import { describe, expect, it, vi } from "vitest";

import type { ErrorReporter } from "./sentry.js";
import type { Telegram } from "./telegram.js";

import { createNotifier } from "./notifier.js";
import { listing, quiet } from "./test-support.js";

function savedMessages(): { sendToMe: ReturnType<typeof vi.fn<Telegram["sendToMe"]>> } {
  return { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
}

function unreachableSavedMessages(): ReturnType<typeof savedMessages> {
  const telegram = savedMessages();
  telegram.sendToMe.mockRejectedValue(new Error("Saved Messages unavailable"));
  return telegram;
}

function reporterSpy(): ErrorReporter & {
  captureException: ReturnType<typeof vi.fn<ErrorReporter["captureException"]>>;
} {
  return {
    captureException: vi.fn<ErrorReporter["captureException"]>(),
    enabled: true,
    run: async (_link, operation) => operation(),
  };
}

describe("notifier", () => {
  it("writes a Match with its link and Notes, and logs it", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const telegram = savedMessages();

    await createNotifier(telegram).verdict(listing(1), { kind: "match", notes: "Looks good" });

    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith("https://t.me/example/1\nLooks good");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/1: Match — Looks good");
  });

  it("writes nothing for No match, and logs it", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const telegram = savedMessages();

    await createNotifier(telegram).verdict(listing(2), { kind: "no-match", notes: "Too far" });

    expect(telegram.sendToMe).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("post https://t.me/example/2: No match — Too far");
  });

  it("tells the owner about an Evaluation failure, because nobody looked at that Post", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const telegram = savedMessages();

    await createNotifier(telegram).verdict(listing(3), {
      error: "Error: gateway failed",
      kind: "evaluation-failure",
    });

    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith(
      "https://t.me/example/3\n⚠️ couldn't evaluate: Error: gateway failed",
    );
    expect(log).toHaveBeenCalledWith(
      "post https://t.me/example/3: Evaluation failure — Error: gateway failed",
    );
  });

  it("logs and reports a failed Match write with the Post link, and does not throw", async () => {
    expect.hasAssertions();
    const consoleError = quiet("error");
    quiet("log");
    const errorReporter = reporterSpy();

    await expect(
      createNotifier(unreachableSavedMessages(), errorReporter).verdict(listing(4), {
        kind: "match",
        notes: "Looks good",
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "post https://t.me/example/4: failed to send notification",
      expect.any(Error),
    );
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "notification",
      postLink: "https://t.me/example/4",
    });
  });

  it("writes a Notice, and reports a failed one without throwing", async () => {
    expect.hasAssertions();
    quiet("error");
    const telegram = savedMessages();
    const errorReporter = reporterSpy();

    await createNotifier(telegram).notice("🟢 criteria: updated", "https://t.me/example/5");
    await expect(
      createNotifier(unreachableSavedMessages(), errorReporter).notice(
        "🟢 criteria: updated",
        "https://t.me/example/5",
      ),
    ).resolves.toBeUndefined();

    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith("🟢 criteria: updated");
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "notice",
      postLink: "https://t.me/example/5",
    });
  });

  it("announces startup with the Watchlist size, and throws if it cannot (ADR-0004)", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const telegram = savedMessages();

    await createNotifier(telegram).started(1);

    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith("🟢 started, watching 1 channel");
    expect(log).toHaveBeenCalledWith("startup: 🟢 started, watching 1 channel");
    await expect(createNotifier(unreachableSavedMessages()).started(2)).rejects.toThrow(
      "Saved Messages unavailable",
    );
  });
});
