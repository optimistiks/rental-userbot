import { rmSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { Evaluator, Verdict } from "./evaluator.js";
import type { PostPipeline, PostPipelineOptions } from "./pipeline.js";
import type { ProcessedPosts } from "./processed-posts.js";
import type { Post, Telegram } from "./telegram.js";

import { createNotifier } from "./notifier.js";
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
async function isProcessed(processedPosts: ProcessedPosts, candidate: Post): Promise<boolean> {
  let ran = false;
  await processedPosts.once(candidate, () => {
    ran = true;
    return Promise.resolve();
  });
  return !ran;
}

type TestPipelineOptions = Omit<PostPipelineOptions, "downloadPhoto" | "notifier"> & {
  telegram: TelegramSpy;
};

/** A pipeline whose Notifier and photo downloads go through `telegram`. */
function createTestPipeline({ telegram, ...options }: TestPipelineOptions): PostPipeline {
  return createPostPipeline({
    ...options,
    downloadPhoto: telegram.downloadPhoto,
    notifier: createNotifier(telegram),
  });
}

/** A stub Evaluator that returns `verdict`; tests using it exercise the pipeline alone. */
function stubEvaluator(verdict?: Verdict): {
  evaluate: ReturnType<typeof vi.fn<Evaluator["evaluate"]>>;
} {
  return {
    evaluate: vi.fn<Evaluator["evaluate"]>(() =>
      Promise.resolve(verdict ?? { kind: "match", notes: "Looks good" }),
    ),
  };
}

interface TelegramSpy {
  downloadPhoto: ReturnType<typeof vi.fn<Telegram["downloadPhoto"]>>;
  sendToMe: ReturnType<typeof vi.fn<Telegram["sendToMe"]>>;
}

function telegramSpy(): TelegramSpy {
  return {
    downloadPhoto: vi.fn<Telegram["downloadPhoto"]>(() => Promise.resolve(new Uint8Array([1]))),
    sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()),
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
    return { kind: match ? "match" : "no-match", notes: `Post ${id}` };
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
  it("skips a Post that is not a Listing without marking it processed", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const processedPosts = memoryProcessedPosts();
    const evaluator = stubEvaluator();
    const telegram = telegramSpy();
    const pipeline = createTestPipeline({
      evaluator,
      ownerFiles: readableOwnerFiles(),
      processedPosts,
      telegram,
    });

    await pipeline.process(post(80, { photos: ["photo-1"], text: "" }));

    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(telegram.sendToMe).not.toHaveBeenCalled();
    await expect(isProcessed(processedPosts, post(80))).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/80: skipped — 1 photo, no text");
  });

  it("evaluates Listings, notifies Matches, and drops other Posts", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const model = verdictModel(
      { match: true, notes: "Looks good" },
      { match: false, notes: "Too expensive" },
    );
    const telegram = telegramSpy();
    const pipeline = createTestPipeline({
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

  it("downloads a Listing's photos through Telegram and sends them to the model", async () => {
    expect.hasAssertions();
    quiet("log");
    const model = verdictModel({ match: true, notes: "Looks good" });
    const telegram = telegramSpy();
    const pipeline = createTestPipeline({
      evaluator: testEvaluator(model),
      ownerFiles: readableOwnerFiles(),
      processedPosts: memoryProcessedPosts(),
      telegram,
    });

    await pipeline.process(post(60));

    expect(telegram.downloadPhoto).toHaveBeenCalledTimes(3);
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
    telegram.downloadPhoto.mockRejectedValue(new Error("expired file reference"));
    const pipeline = createTestPipeline({
      evaluator: testEvaluator(model),
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
    const pipeline = createTestPipeline({
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
    const pipeline = createTestPipeline({
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
    const pipeline = createTestPipeline({
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

  it("does not evaluate a Listing while Criteria is unreadable", async () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    const processedPosts = memoryProcessedPosts();
    const evaluator = stubEvaluator();
    const telegram = telegramSpy();
    const pipeline = createTestPipeline({ evaluator, ownerFiles, processedPosts, telegram });
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
    const pipeline = createTestPipeline({ evaluator, ownerFiles, processedPosts, telegram });
    writeFileSync(files.criteriaPath, "Want a quieter street.\n");

    await pipeline.process(post(42));

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(1, "🟢 criteria: updated");
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(2, "https://t.me/example/42\nLooks good");
    await expect(isProcessed(processedPosts, post(42))).resolves.toBe(true);
  });
});
