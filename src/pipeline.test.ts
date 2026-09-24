import { rmSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Evaluator, Verdict } from "./evaluator.js";
import type { ProcessedPosts } from "./processed-posts.js";
import type { ErrorReporter } from "./sentry.js";
import type { PhotoRef, Post, Telegram } from "./telegram.js";

import { openOwnerFiles } from "./owner-files.js";
import { createPostPipeline } from "./pipeline.js";
import {
  memoryProcessedPosts,
  post,
  quiet,
  readableOwnerFiles,
  testEvaluator,
  verdictModel,
  writeOwnerFiles,
} from "./test-support.js";

/** Asks through the interface: a Post is processed when `once` turns it away. Marks it as a side effect. */
async function isProcessed(processedPosts: ProcessedPosts, listing: Post): Promise<boolean> {
  let handled = false;
  await processedPosts.once(listing, () => {
    handled = true;
    return Promise.resolve();
  });
  return !handled;
}

/** A stub Evaluator that returns `verdict`; tests using it exercise the pipeline alone. */
function stubEvaluator(verdict?: Verdict): {
  evaluate: ReturnType<typeof vi.fn<Evaluator["evaluate"]>>;
} {
  return {
    evaluate: vi.fn<Evaluator["evaluate"]>(() =>
      Promise.resolve(verdict ?? { match: true, notes: "Looks good" }),
    ),
  };
}

function telegramSpy(): { sendToMe: ReturnType<typeof vi.fn<Telegram["sendToMe"]>> } {
  return { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
}

function failingTelegram(): { sendToMe: ReturnType<typeof vi.fn<Telegram["sendToMe"]>> } {
  return {
    sendToMe: vi.fn<Telegram["sendToMe"]>(() =>
      Promise.reject(new Error("Saved Messages unavailable")),
    ),
  };
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

/** An Evaluator whose runs each block until the test releases them by Post ID. */
function blockingEvaluator(): {
  evaluator: { evaluate: ReturnType<typeof vi.fn<Evaluator["evaluate"]>> };
  started: number[];
  running: () => number;
  release: (id: number, match?: boolean) => void;
} {
  const releases = new Map<number, (match: boolean) => void>();
  const started: number[] = [];
  let active = 0;
  const evaluate = vi.fn<Evaluator["evaluate"]>(async (listing) => {
    const id = Number(listing.link.split("/").at(-1));
    started.push(id);
    active += 1;
    const match = await new Promise<boolean>((resolve) => {
      releases.set(id, resolve);
    });
    active -= 1;
    return { match, notes: `Post ${id}` };
  });
  return {
    evaluator: { evaluate },
    release: (id, match = false) => {
      releases.get(id)?.(match);
    },
    running: () => active,
    started,
  };
}

describe("post pipeline", () => {
  it.each([
    ["no text and one photo", "", ["photo-1"], "1 photo, no text"],
    ["text but fewer than three photos", "Сдается квартира Батуми", ["photo-1"], "1 photo"],
    ["three photos but no text", "", ["photo-1", "photo-2", "photo-3"], "3 photos, no text"],
  ])(
    "ignores a Post with %s and does not mark it processed",
    async (_case, text, photos: PhotoRef[], skip) => {
      expect.hasAssertions();
      const log = quiet("log");
      const processedPosts = memoryProcessedPosts();
      const evaluator = stubEvaluator();
      const telegram = telegramSpy();
      const pipeline = createPostPipeline({
        evaluator,
        ownerFiles: readableOwnerFiles(),
        processedPosts,
        telegram,
      });

      await pipeline.process(post(80, { photos, text }));

      expect(evaluator.evaluate).not.toHaveBeenCalled();
      expect(telegram.sendToMe).not.toHaveBeenCalled();
      await expect(isProcessed(processedPosts, post(80))).resolves.toBe(false);
      expect(log).toHaveBeenCalledWith(`post https://t.me/example/80: skipped — ${skip}`);
    },
  );

  it("still notifies and marks the Post when the Evaluator throws", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
    const errorReporter = reporterSpy();
    const processedPosts = memoryProcessedPosts();
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() => Promise.reject(new Error("evaluator exploded"))),
    };
    const telegram = telegramSpy();
    const pipeline = createPostPipeline({
      errorReporter,
      evaluator,
      ownerFiles: readableOwnerFiles(),
      processedPosts,
      telegram,
    });

    await pipeline.process(post(77));

    expect(telegram.sendToMe).toHaveBeenCalledWith(
      "https://t.me/example/77\n⚠️ couldn't evaluate: Error: evaluator exploded",
    );
    await expect(isProcessed(processedPosts, post(77))).resolves.toBe(true);
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "evaluation",
      postLink: "https://t.me/example/77",
    });
  });

  it("reports a failed notification with the Post link without blocking the queue", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
    const errorReporter = reporterSpy();
    const pipeline = createPostPipeline({
      errorReporter,
      evaluator: stubEvaluator(),
      ownerFiles: readableOwnerFiles(),
      processedPosts: memoryProcessedPosts(),
      telegram: failingTelegram(),
    });

    await expect(pipeline.process(post(54))).resolves.toBeUndefined();

    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "notification",
      postLink: "https://t.me/example/54",
    });
  });

  it("evaluates Listings, notifies Matches, and drops other Posts", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const model = verdictModel(
      { match: true, notes: "Looks good" },
      { match: false, notes: "Too expensive" },
    );
    const telegram = telegramSpy();
    const pipeline = createPostPipeline({
      evaluator: testEvaluator(model),
      ownerFiles: readableOwnerFiles(),
      processedPosts: memoryProcessedPosts(),
      telegram,
    });

    await pipeline.process(post(1));
    await pipeline.process(post(2, { text: "Another flat" }));
    await pipeline.process(post(4, { photos: [], text: "" }));

    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/1\nLooks good");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/1: Match — Looks good");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/2: No match — Too expensive");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/4: skipped — 0 photos, no text");
  });

  it("evaluates an album once, sends its photos to the model, and drops a late part", async () => {
    expect.hasAssertions();
    quiet("log");
    const model = verdictModel({ match: true, notes: "Looks good" });
    const downloadPhoto = vi.fn<(photo: PhotoRef) => Promise<Uint8Array>>(() =>
      Promise.resolve(new Uint8Array([1])),
    );
    const telegram = telegramSpy();
    const pipeline = createPostPipeline({
      evaluator: testEvaluator(model, { downloadPhoto }),
      ownerFiles: readableOwnerFiles(),
      processedPosts: memoryProcessedPosts(),
      telegram,
    });

    await pipeline.process(post(60, { albumId: "album-8", messageIds: [60, 61] }));
    await pipeline.process(post(62, { albumId: "album-8", text: "Late album part" }));

    expect(downloadPhoto).toHaveBeenCalledTimes(3);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith(
      "https://t.me/example/60\nLooks good",
    );
  });

  it("still evaluates a Listing when photo downloads fail", async () => {
    expect.hasAssertions();
    quiet("log");
    quiet("warn");
    const model = verdictModel({ match: false, notes: "No photos left" });
    const processedPosts = memoryProcessedPosts();
    const telegram = telegramSpy();
    const pipeline = createPostPipeline({
      evaluator: testEvaluator(model, {
        downloadPhoto: () => Promise.reject(new Error("expired file reference")),
      }),
      ownerFiles: readableOwnerFiles(),
      processedPosts,
      telegram,
    });

    await pipeline.process(post(70));

    expect(model.doGenerateCalls).toHaveLength(1);
    await expect(isProcessed(processedPosts, post(70))).resolves.toBe(true);
    expect(telegram.sendToMe).not.toHaveBeenCalled();
  });

  it("evaluates up to the configured number of Listings at once, starting them in arrival order", async () => {
    expect.hasAssertions();
    quiet("log");
    const processedPosts = memoryProcessedPosts();
    const { evaluator, release, running, started } = blockingEvaluator();
    const pipeline = createPostPipeline({
      concurrency: 2,
      evaluator,
      ownerFiles: readableOwnerFiles(),
      processedPosts,
      telegram: telegramSpy(),
    });
    const processed = [11, 12, 13, 14].map((id) => pipeline.process(post(id)));

    await vi.waitFor(() => {
      expect(started).toStrictEqual([11, 12]);
    });
    expect(running()).toBe(2);

    release(12);
    await vi.waitFor(() => {
      expect(started).toStrictEqual([11, 12, 13]);
    });
    expect(running()).toBe(2);

    release(11);
    release(13);
    await vi.waitFor(() => {
      expect(started).toStrictEqual([11, 12, 13, 14]);
    });
    release(14);
    await Promise.all(processed);

    await expect(isProcessed(processedPosts, post(14))).resolves.toBe(true);
  });

  it("notifies a Match as soon as it is ready, even while an older Listing is still running", async () => {
    expect.hasAssertions();
    quiet("log");
    const processedPosts = memoryProcessedPosts();
    const { evaluator, release, started } = blockingEvaluator();
    const telegram = telegramSpy();
    const pipeline = createPostPipeline({
      concurrency: 2,
      evaluator,
      ownerFiles: readableOwnerFiles(),
      processedPosts,
      telegram,
    });
    const older = pipeline.process(post(21));
    const newer = pipeline.process(post(22));
    await vi.waitFor(() => {
      expect(started).toStrictEqual([21, 22]);
    });

    release(22, true);
    await newer;

    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith("https://t.me/example/22\nPost 22");
    release(21);
    await older;
  });

  it("evaluates a duplicate once whether it arrives while the first copy is running or waiting", async () => {
    expect.hasAssertions();
    quiet("log");
    const { evaluator, release, started } = blockingEvaluator();
    const pipeline = createPostPipeline({
      concurrency: 2,
      evaluator,
      ownerFiles: readableOwnerFiles(),
      processedPosts: memoryProcessedPosts(),
      telegram: telegramSpy(),
    });
    const processed = [31, 31, 32, 33, 33].map((id) => pipeline.process(post(id)));

    // The running copy of 31 does not let its duplicate take the second slot.
    await vi.waitFor(() => {
      expect(started).toStrictEqual([31, 32]);
    });
    release(31);
    await vi.waitFor(() => {
      expect(started).toStrictEqual([31, 32, 33]);
    });
    release(32);
    release(33);
    await Promise.all(processed);

    expect(evaluator.evaluate).toHaveBeenCalledTimes(3);
  });

  it("marks a Post after a failed notification so it is not retried", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
    const evaluator = stubEvaluator();
    const telegram = failingTelegram();
    const pipeline = createPostPipeline({
      evaluator,
      ownerFiles: readableOwnerFiles(),
      processedPosts: memoryProcessedPosts(),
      telegram,
    });

    await expect(pipeline.process(post(9))).resolves.toBeUndefined();
    await pipeline.process(post(9));

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
  });

  it("does not evaluate a Listing while Criteria is unreadable", async () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    const processedPosts = memoryProcessedPosts();
    const evaluator = stubEvaluator();
    const telegram = telegramSpy();
    const pipeline = createPostPipeline({ evaluator, ownerFiles, processedPosts, telegram });
    rmSync(files.criteriaPath);

    await pipeline.process(post(41));

    expect(telegram.sendToMe).toHaveBeenCalledWith("⚠️ criteria: not readable");
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    await expect(isProcessed(processedPosts, post(41))).resolves.toBe(false);
  });

  it("still evaluates a Listing when a Notice fails to send", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    const processedPosts = memoryProcessedPosts();
    const evaluator = stubEvaluator();
    const telegram = telegramSpy();
    telegram.sendToMe.mockRejectedValueOnce(new Error("Saved Messages unavailable"));
    const pipeline = createPostPipeline({ evaluator, ownerFiles, processedPosts, telegram });
    writeFileSync(files.criteriaPath, "Want a quieter street.\n");

    await pipeline.process(post(42));

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(1, "🟢 criteria: updated");
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(2, "https://t.me/example/42\nLooks good");
    await expect(isProcessed(processedPosts, post(42))).resolves.toBe(true);
  });
});
