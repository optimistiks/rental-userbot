/* The live-reload test drives the real Watchlist through the pipeline, one module past
   the cap for this file; the alternative is a stub, which cannot prove a re-read. */
// oxlint-disable import/max-dependencies
import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type {
  Evaluator,
  EvaluatorOptions,
  EvaluatorToolImplementations,
  Listing,
} from "./evaluator.js";
import type { ErrorReporter } from "./sentry.js";
import type { PhotoRef, Post, Telegram } from "./telegram.js";
import type { Watchlist } from "./watchlist.js";

import { openDedupeStore } from "./dedupe-store.js";
import { createEvaluator, createEvaluatorTools } from "./evaluator.js";
import { createNotices } from "./notices.js";
import { createPostPipeline } from "./pipeline.js";
import { createWatchlist } from "./watchlist.js";

const usage = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 10, total: 10 },
  outputTokens: { reasoning: undefined, text: 5, total: 5 },
};

const staticWatchlist: Watchlist = { channelIds: () => [-1_001_234_567_890] };

function photo(): PhotoRef {
  return { __photoRef: true };
}

function post(
  chatId: number,
  text: string,
  id: number,
  photos: PhotoRef[] = [photo(), photo(), photo()],
): Post {
  return {
    chatId,
    link: `https://t.me/example/${id}`,
    messageIds: [id],
    photos,
    text,
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
    const id = Number(listing.link?.split("/").at(-1));
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
  it("ignores a Post that is not a Listing and does not mark it processed", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Should not run" }),
      ),
    };
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(-1_001_234_567_890, "", 80, [photo()]));

    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(telegram.sendToMe).not.toHaveBeenCalled();
    expect(dedupeStore.isProcessed("-1001234567890:80")).toBe(false);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/80: skipped — 1 photo, no text");
    log.mockRestore();
    dedupeStore.close();
  });

  it("ignores a Post with text but fewer than three photos", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Should not run" }),
      ),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(-1_001_234_567_890, "Сдается квартира Батуми", 81, [photo()]));

    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(dedupeStore.isProcessed("-1001234567890:81")).toBe(false);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/81: skipped — 1 photo");
    log.mockRestore();
    dedupeStore.close();
  });

  it("ignores a Post with three photos but no text", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Should not run" }),
      ),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(-1_001_234_567_890, "", 82));

    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(dedupeStore.isProcessed("-1001234567890:82")).toBe(false);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/82: skipped — 3 photos, no text");
    log.mockRestore();
    dedupeStore.close();
  });

  it("still notifies and marks the Post when the Evaluator throws", async () => {
    expect.hasAssertions();
    const errorReporter: ErrorReporter = {
      captureException: vi.fn<ErrorReporter["captureException"]>(),
      enabled: true,
      run: async (_link, operation) => operation(),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() => Promise.reject(new Error("evaluator exploded"))),
    };
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      errorReporter,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(-1_001_234_567_890, "Flat for rent", 77));

    expect(telegram.sendToMe).toHaveBeenCalledWith(
      "https://t.me/example/77\n⚠️ couldn't evaluate: Error: evaluator exploded",
    );
    expect(dedupeStore.isProcessed("-1001234567890:77")).toBe(true);
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "evaluation",
      postLink: "https://t.me/example/77",
    });

    error.mockRestore();
    log.mockRestore();
    dedupeStore.close();
  });

  it("reports a failed notification with the Post link without blocking the queue", async () => {
    expect.hasAssertions();
    const errorReporter: ErrorReporter = {
      captureException: vi.fn<ErrorReporter["captureException"]>(),
      enabled: true,
      run: async (_link, operation) => operation(),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Looks good" }),
      ),
    };
    const telegram = {
      sendToMe: vi.fn<Telegram["sendToMe"]>(() =>
        Promise.reject(new Error("Saved Messages unavailable")),
      ),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      errorReporter,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });

    await expect(
      pipeline.process(post(-1_001_234_567_890, "Flat for rent", 54)),
    ).resolves.toBeUndefined();

    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "notification",
      postLink: "https://t.me/example/54",
    });
    log.mockRestore();
    dedupeStore.close();
  });

  it("sends the Verdict chosen after locating every candidate in the Zone", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              input: JSON.stringify({ query: "Gorgasali 33" }),
              toolCallId: "locate-1",
              toolName: "locateInZone",
              type: "tool-call",
            },
          ],
          finishReason: { raw: undefined, unified: "tool-calls" },
          usage,
          warnings: [],
        },
        {
          content: [{ text: JSON.stringify({ match: true, notes: "Agent notes" }), type: "text" }],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const geocode = vi.fn<EvaluatorToolImplementations["geocode"]>(() =>
      Promise.resolve({
        results: [
          {
            label: "Gorgasali 33, Batumi",
            lat: 41.6481086,
            lon: 41.6393883,
            precision: "building" as const,
          },
        ],
      }),
    );
    const inZone = vi.fn<EvaluatorToolImplementations["inZone"]>(() => ({
      inside: true,
      zone: "Old Batumi",
    }));
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { model, tools: createEvaluatorTools({ geocode, inZone }) },
    );
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(-1_001_234_567_890, "Flat at Gorgasali 33", 10));

    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/10\nAgent notes");
    expect(model.doGenerateCalls).toHaveLength(2);
    dedupeStore.close();
  });

  it("evaluates watched text Posts, notifies Matches, and drops other Posts", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ text: JSON.stringify({ match: true, notes: "Looks good" }), type: "text" }],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        },
        {
          content: [
            { text: JSON.stringify({ match: false, notes: "Too expensive" }), type: "text" },
          ],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { model },
    );
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await pipeline.process(post(-1_001_234_567_890, "Flat for rent", 1));
    await pipeline.process(post(-1_001_234_567_890, "Another flat", 2));
    await pipeline.process(post(-1_009_876_543_210, "Unwatched flat", 3));
    await pipeline.process(post(-1_001_234_567_890, "", 4, []));

    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/1\nLooks good");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/1: Match — Looks good");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/2: No match — Too expensive");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/4: skipped — 0 photos, no text");
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates an album once, sends its photos to the model, and drops a late part", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const firstPhoto = photo();
    const secondPhoto = photo();
    const thirdPhoto = photo();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ text: JSON.stringify({ match: true, notes: "Looks good" }), type: "text" }],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      },
    });
    const downloadPhoto = vi
      .fn<(photo: PhotoRef) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
      .mockResolvedValueOnce(new Uint8Array([3]));
    const telegram = {
      downloadPhoto,
      sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { downloadPhoto, model },
    );
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await pipeline.process({
      albumId: "album-8",
      chatId: -1_001_234_567_890,
      link: "https://t.me/example/60",
      messageIds: [60, 61],
      photos: [firstPhoto, secondPhoto, thirdPhoto],
      text: "Flat with a balcony",
    });
    await pipeline.process({
      albumId: "album-8",
      chatId: -1_001_234_567_890,
      link: "https://t.me/example/62",
      messageIds: [62],
      photos: [firstPhoto],
      text: "Late album part",
    });

    expect(downloadPhoto).toHaveBeenCalledTimes(3);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/60\nLooks good");
    log.mockRestore();
    dedupeStore.close();
  });

  it("still evaluates a Listing when photo downloads fail", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          { text: JSON.stringify({ match: false, notes: "No photos left" }), type: "text" },
        ],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      },
    });
    const downloadPhoto = vi.fn<NonNullable<EvaluatorOptions["downloadPhoto"]>>(() =>
      Promise.reject(new Error("expired file reference")),
    );
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { downloadPhoto, model },
    );
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await pipeline.process(post(-1_001_234_567_890, "Flat for rent", 70));

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(dedupeStore.isProcessed("-1001234567890:70")).toBe(true);
    expect(telegram.sendToMe).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    dedupeStore.close();
  });

  it("evaluates duplicate Posts delivered before the first one is marked only once", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    let releaseFirst!: () => void;
    const firstEvaluation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(async () => {
        await firstEvaluation;
        return { match: false, notes: "No match" };
      }),
    };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const first = pipeline.process(post(-1_001_234_567_890, "Flat for rent", 5));
    const duplicate = pipeline.process(post(-1_001_234_567_890, "Flat for rent", 5));

    await vi.waitFor(() => {
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    });
    releaseFirst();
    await Promise.all([first, duplicate]);

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(dedupeStore.isProcessed("-1001234567890:5")).toBe(true);
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates queued Posts one at a time", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    let releaseFirst!: () => void;
    const firstEvaluation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let activeEvaluations = 0;
    let maximumActiveEvaluations = 0;
    const evaluationOrder: number[] = [];
    const enter = (listing: Listing): void => {
      activeEvaluations += 1;
      maximumActiveEvaluations = Math.max(maximumActiveEvaluations, activeEvaluations);
      evaluationOrder.push(Number(listing.link?.split("/").at(-1)));
    };
    const evaluator = {
      evaluate: vi
        .fn<Evaluator["evaluate"]>()
        // The first post blocks until the test releases it; the rest run straight through.
        .mockImplementationOnce(async (listing) => {
          enter(listing);
          await firstEvaluation;
          activeEvaluations -= 1;
          return { match: false, notes: "No match" };
        })
        .mockImplementation((listing) => {
          enter(listing);
          activeEvaluations -= 1;
          return Promise.resolve({ match: false, notes: "No match" });
        }),
    };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const first = pipeline.process(post(-1_001_234_567_890, "First flat", 6));
    const second = pipeline.process(post(-1_001_234_567_890, "Second flat", 7));

    await vi.waitFor(() => {
      expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    });
    expect(evaluationOrder).toStrictEqual([6]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(evaluationOrder).toStrictEqual([6, 7]);
    expect(maximumActiveEvaluations).toBe(1);
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates up to the configured number of Listings at once, starting them in arrival order", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const { evaluator, release, running, started } = blockingEvaluator();
    const pipeline = createPostPipeline({
      concurrency: 2,
      dedupeStore,
      evaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const processed = [11, 12, 13, 14].map((id) =>
      pipeline.process(post(-1_001_234_567_890, `Flat ${id}`, id)),
    );

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

    expect(dedupeStore.isProcessed("-1001234567890:14")).toBe(true);
    log.mockRestore();
    dedupeStore.close();
  });

  it("notifies a Match as soon as it is ready, even while an older Listing is still running", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const { evaluator, release, started } = blockingEvaluator();
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const pipeline = createPostPipeline({
      concurrency: 2,
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const older = pipeline.process(post(-1_001_234_567_890, "Older flat", 21));
    const newer = pipeline.process(post(-1_001_234_567_890, "Newer flat", 22));
    await vi.waitFor(() => {
      expect(started).toStrictEqual([21, 22]);
    });

    release(22, true);
    await newer;

    expect(telegram.sendToMe).toHaveBeenCalledExactlyOnceWith("https://t.me/example/22\nPost 22");
    expect(dedupeStore.isProcessed("-1001234567890:21")).toBe(false);
    release(21);
    await older;
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates a duplicate once whether it arrives while the first copy is running or waiting", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const { evaluator, release, started } = blockingEvaluator();
    const pipeline = createPostPipeline({
      concurrency: 2,
      dedupeStore,
      evaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const processed = [31, 31, 32, 33, 33].map((id) =>
      pipeline.process(post(-1_001_234_567_890, `Flat ${id}`, id)),
    );

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
    expect(dedupeStore.isProcessed("-1001234567890:33")).toBe(true);
    log.mockRestore();
    dedupeStore.close();
  });

  it("does not re-evaluate a Processed Post across pipeline instances sharing a store", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const firstEvaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: false, notes: "No match" }),
      ),
    };
    const firstPipeline = createPostPipeline({
      dedupeStore,
      evaluator: firstEvaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const firstPost = post(-1_001_234_567_890, "Already processed", 8);

    await firstPipeline.process(firstPost);

    const secondEvaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: false, notes: "No match" }),
      ),
    };
    const secondPipeline = createPostPipeline({
      dedupeStore,
      evaluator: secondEvaluator,
      telegram: { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) },
      watchlist: staticWatchlist,
    });

    await secondPipeline.process(firstPost);

    expect(firstEvaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(secondEvaluator.evaluate).not.toHaveBeenCalled();
    log.mockRestore();
    dedupeStore.close();
  });

  it("marks a Post after a failed notification so it is not retried", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Looks good" }),
      ),
    };
    const telegram = {
      sendToMe: vi.fn<Telegram["sendToMe"]>(() =>
        Promise.reject(new Error("Saved Messages unavailable")),
      ),
    };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });
    const postToProcess = post(-1_001_234_567_890, "Flat for rent", 9);

    await expect(pipeline.process(postToProcess)).resolves.toBeUndefined();
    await pipeline.process(postToProcess);

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
    expect(dedupeStore.isProcessed("-1001234567890:9")).toBe(true);
    dedupeStore.close();
  });

  it("watches a channel added to the watchlist file and drops one removed from it", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const channelsPath = path.join(directory, "channels.txt");
    writeFileSync(channelsPath, "-1001234567890  # watched for now\n");
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Looks good" }),
      ),
    };
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: createWatchlist(channelsPath),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await pipeline.process(post(-1_001_234_567_890, "Flat for rent", 30));

    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/30\nLooks good");

    writeFileSync(channelsPath, "-1009876543210\n");

    await pipeline.process(post(-1_001_234_567_890, "Another flat", 31));

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "watchlist: watching 1 channel; added -1009876543210; removed -1001234567890",
    );
    log.mockRestore();
    dedupeStore.close();
  });

  it("sends a Watchlist Notice from an unwatched Post", async () => {
    expect.hasAssertions();
    const files = noticeFiles();
    const notices = createNotices(files);
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Should not run" }),
      ),
    };
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      notices,
      telegram,
      watchlist: createWatchlist(files.channelsPath),
    });
    writeFileSync(files.channelsPath, "-1001234567890\n-1009876543210\n");

    await pipeline.process(post(-1_009_000_000_001, "Elsewhere", 40));

    expect(telegram.sendToMe).toHaveBeenCalledWith(
      "🟢 watchlist: watching 2 channels; added -1009876543210",
    );
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    dedupeStore.close();
  });

  it("does not evaluate a Listing while Criteria is unreadable", async () => {
    expect.hasAssertions();
    const files = noticeFiles();
    const notices = createNotices(files);
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Should not run" }),
      ),
    };
    const telegram = { sendToMe: vi.fn<Telegram["sendToMe"]>(() => Promise.resolve()) };
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      notices,
      telegram,
      watchlist: staticWatchlist,
    });
    rmSync(files.criteriaPath);

    await pipeline.process(post(-1_001_234_567_890, "Flat for rent", 41));

    expect(telegram.sendToMe).toHaveBeenCalledWith("⚠️ criteria: not readable");
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(dedupeStore.isProcessed("-1001234567890:41")).toBe(false);
    dedupeStore.close();
  });

  it("still evaluates a Listing when a Notice fails to send", async () => {
    expect.hasAssertions();
    const files = noticeFiles();
    const notices = createNotices(files);
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn<Evaluator["evaluate"]>(() =>
        Promise.resolve({ match: true, notes: "Looks good" }),
      ),
    };
    const telegram = {
      sendToMe: vi
        .fn<Telegram["sendToMe"]>()
        .mockRejectedValueOnce(new Error("Saved Messages unavailable"))
        .mockResolvedValue(),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      notices,
      telegram,
      watchlist: staticWatchlist,
    });
    writeFileSync(files.criteriaPath, "Want a quieter street.\n");

    await pipeline.process(post(-1_001_234_567_890, "Flat for rent", 42));

    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(1, "🟢 criteria: updated");
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(2, "https://t.me/example/42\nLooks good");
    expect(dedupeStore.isProcessed("-1001234567890:42")).toBe(true);
    error.mockRestore();
    dedupeStore.close();
  });
});

function noticeFiles(): {
  channelsPath: string;
  criteriaPath: string;
  promptPath: string;
  zonePath: string;
} {
  const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
  const channelsPath = path.join(directory, "channels.txt");
  const criteriaPath = path.join(directory, "criteria.md");
  const promptPath = path.join(directory, "prompt.md");
  const zonePath = path.join(directory, "zone.geojson");
  writeFileSync(channelsPath, "-1001234567890\n");
  writeFileSync(criteriaPath, "Want a 1+1 in Old Town.\n");
  writeFileSync(promptPath, "Judge the listing.\n");
  writeFileSync(
    zonePath,
    JSON.stringify({
      features: [
        {
          geometry: {
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
            type: "Polygon",
          },
          properties: { name: "Old Batumi" },
          type: "Feature",
        },
      ],
      type: "FeatureCollection",
    }),
  );
  return { channelsPath, criteriaPath, promptPath, zonePath };
}
