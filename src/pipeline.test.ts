import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ErrorReporter } from "./sentry.js";
import type { PhotoRef, Post } from "./telegram.js";

import { openDedupeStore } from "./dedupe-store.js";
import { createEvaluator, createEvaluatorTools } from "./evaluator.js";
import { createPostPipeline } from "./pipeline.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function post(chatId: number, text: string, id: number): Post {
  return {
    chatId,
    messageIds: [id],
    text,
    photos: [],
    link: `https://t.me/example/${id}`,
  };
}

describe("Post pipeline", () => {
  it("still notifies and marks the Post when the Evaluator throws", async () => {
    const errorReporter: ErrorReporter = {
      enabled: true,
      run: vi.fn(async (_link, operation) => operation()),
      captureException: vi.fn(),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn(async () => {
        throw new Error("evaluator exploded");
      }),
    };
    const telegram = { sendToMe: vi.fn(async () => undefined) };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
      errorReporter,
    });

    await pipeline.process(post(-1001234567890, "Flat for rent", 77));

    expect(telegram.sendToMe).toHaveBeenCalledWith(
      "https://t.me/example/77\n⚠️ couldn't evaluate: Error: evaluator exploded",
    );
    expect(dedupeStore.isProcessed("-1001234567890:77")).toBe(true);
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      postLink: "https://t.me/example/77",
      phase: "evaluation",
    });

    error.mockRestore();
    log.mockRestore();
    dedupeStore.close();
  });

  it("reports a failed notification with the Post link without blocking the queue", async () => {
    const errorReporter: ErrorReporter = {
      enabled: true,
      run: vi.fn(async (_link, operation) => operation()),
      captureException: vi.fn(),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn(async () => ({ match: true, notes: "Looks good" })),
    };
    const telegram = {
      sendToMe: vi.fn(async () => {
        throw new Error("Saved Messages unavailable");
      }),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
      errorReporter,
    });

    await expect(
      pipeline.process(post(-1001234567890, "Flat for rent", 54)),
    ).resolves.toBeUndefined();

    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      postLink: "https://t.me/example/54",
      phase: "notification",
    });
    log.mockRestore();
    dedupeStore.close();
  });

  it("sends the Verdict chosen after geocoding and checking the Zone", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const promptPath = join(directory, "prompt.md");
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "geocode-1",
              toolName: "geocode",
              input: JSON.stringify({ query: "Gorgasali 33" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "in-zone-1",
              toolName: "inZone",
              input: JSON.stringify({ lat: 41.6481086, lon: 41.6393883 }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: JSON.stringify({ match: true, notes: "Agent notes" }) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    });
    const geocode = vi.fn(async () => ({
      results: [
        {
          precision: "building" as const,
          lat: 41.6481086,
          lon: 41.6393883,
          label: "Gorgasali 33, Batumi",
        },
      ],
    }));
    const inZone = vi.fn(() => ({ inside: true, zone: "Old Batumi" }));
    const telegram = { sendToMe: vi.fn(async () => undefined) };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { modelId: "test/model", promptPath, criteriaPath },
      { model, tools: createEvaluatorTools({ geocode, inZone }) },
    );
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    });

    await pipeline.process(post(-1001234567890, "Flat at Gorgasali 33", 10));

    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/10\nAgent notes");
    expect(model.doGenerateCalls).toHaveLength(3);
    dedupeStore.close();
  });

  it("evaluates watched text Posts, notifies Matches, and drops other Posts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const promptPath = join(directory, "prompt.md");
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: "text", text: JSON.stringify({ match: true, notes: "Looks good" }) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [
            { type: "text", text: JSON.stringify({ match: false, notes: "Too expensive" }) },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    });
    const telegram = { sendToMe: vi.fn(async () => undefined) };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { modelId: "test/model", promptPath, criteriaPath },
      { model },
    );
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await pipeline.process(post(-1001234567890, "Flat for rent", 1));
    await pipeline.process(post(-1001234567890, "Another flat", 2));
    await pipeline.process(post(-1009876543210, "Unwatched flat", 3));
    await pipeline.process(post(-1001234567890, "", 4));

    expect(telegram.sendToMe).toHaveBeenCalledOnce();
    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/1\nLooks good");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("post https://t.me/example/1: Match — Looks good");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/2: No match — Too expensive");
    expect(log).toHaveBeenCalledWith("post https://t.me/example/4: dropped empty Post");
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates an album once, sends its photos to the model, and drops a late part", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const promptPath = join(directory, "prompt.md");
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const firstPhoto = { __photoRef: true } as PhotoRef;
    const secondPhoto = { __photoRef: true } as PhotoRef;
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify({ match: true, notes: "Looks good" }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const downloadPhoto = vi
      .fn<(photo: PhotoRef) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]));
    const telegram = {
      sendToMe: vi.fn(async () => undefined),
      downloadPhoto,
    };
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { modelId: "test/model", promptPath, criteriaPath },
      { model, downloadPhoto },
    );
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await pipeline.process({
      chatId: -1001234567890,
      messageIds: [60, 61],
      albumId: "album-8",
      text: "Flat with a balcony",
      photos: [firstPhoto, secondPhoto],
      link: "https://t.me/example/60",
    });
    await pipeline.process({
      chatId: -1001234567890,
      messageIds: [62],
      albumId: "album-8",
      text: "Late album part",
      photos: [firstPhoto],
      link: "https://t.me/example/62",
    });

    expect(downloadPhoto).toHaveBeenCalledTimes(2);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(telegram.sendToMe).toHaveBeenCalledOnce();
    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/60\nLooks good");
    log.mockRestore();
    dedupeStore.close();
  });

  it("marks a textless Post processed without an agent run when every photo fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
    const promptPath = join(directory, "prompt.md");
    const criteriaPath = join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const photo = { __photoRef: true } as PhotoRef;
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify({ match: true, notes: "Should not run" }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const downloadPhoto = vi.fn(async () => {
      throw new Error("expired file reference");
    });
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = createEvaluator(
      { modelId: "test/model", promptPath, criteriaPath },
      { model, downloadPhoto },
    );
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await pipeline.process({
      chatId: -1001234567890,
      messageIds: [70],
      text: "",
      photos: [photo],
      link: "https://t.me/example/70",
    });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(dedupeStore.isProcessed("-1001234567890:70")).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "post https://t.me/example/70: No match — No text or photos remain",
    );
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates duplicate Posts delivered before the first one is marked only once", async () => {
    const dedupeStore = openDedupeStore(":memory:");
    let releaseFirst!: () => void;
    const firstEvaluation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const evaluator = {
      evaluate: vi.fn(async () => {
        await firstEvaluation;
        return { match: false, notes: "No match" };
      }),
    };
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const first = pipeline.process(post(-1001234567890, "Flat for rent", 5));
    const duplicate = pipeline.process(post(-1001234567890, "Flat for rent", 5));

    await vi.waitFor(() => expect(evaluator.evaluate).toHaveBeenCalledOnce());
    releaseFirst();
    await Promise.all([first, duplicate]);

    expect(evaluator.evaluate).toHaveBeenCalledOnce();
    expect(dedupeStore.isProcessed("-1001234567890:5")).toBe(true);
    log.mockRestore();
    dedupeStore.close();
  });

  it("evaluates queued Posts one at a time", async () => {
    const dedupeStore = openDedupeStore(":memory:");
    let releaseFirst!: () => void;
    const firstEvaluation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let activeEvaluations = 0;
    let maximumActiveEvaluations = 0;
    const evaluationOrder: number[] = [];
    const evaluator = {
      evaluate: vi.fn(async (post: Post) => {
        activeEvaluations += 1;
        maximumActiveEvaluations = Math.max(maximumActiveEvaluations, activeEvaluations);
        evaluationOrder.push(post.messageIds[0]);

        if (post.messageIds[0] === 6) {
          await firstEvaluation;
        }

        activeEvaluations -= 1;
        return { match: false, notes: "No match" };
      }),
    };
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const first = pipeline.process(post(-1001234567890, "First flat", 6));
    const second = pipeline.process(post(-1001234567890, "Second flat", 7));

    await vi.waitFor(() => expect(evaluator.evaluate).toHaveBeenCalledOnce());
    expect(evaluationOrder).toEqual([6]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(evaluationOrder).toEqual([6, 7]);
    expect(maximumActiveEvaluations).toBe(1);
    log.mockRestore();
    dedupeStore.close();
  });

  it("does not re-evaluate a Processed Post across pipeline instances sharing a store", async () => {
    const dedupeStore = openDedupeStore(":memory:");
    const firstEvaluator = { evaluate: vi.fn(async () => ({ match: false, notes: "No match" })) };
    const firstPipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator: firstEvaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const firstPost = post(-1001234567890, "Already processed", 8);

    await firstPipeline.process(firstPost);

    const secondEvaluator = { evaluate: vi.fn(async () => ({ match: false, notes: "No match" })) };
    const secondPipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator: secondEvaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    });

    await secondPipeline.process(firstPost);

    expect(firstEvaluator.evaluate).toHaveBeenCalledOnce();
    expect(secondEvaluator.evaluate).not.toHaveBeenCalled();
    log.mockRestore();
    dedupeStore.close();
  });

  it("marks a Post after a failed notification so it is not retried", async () => {
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi.fn(async () => ({ match: true, notes: "Looks good" })),
    };
    const telegram = {
      sendToMe: vi.fn(async () => {
        throw new Error("Saved Messages unavailable");
      }),
    };
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    });
    const postToProcess = post(-1001234567890, "Flat for rent", 9);

    await expect(pipeline.process(postToProcess)).resolves.toBeUndefined();
    await pipeline.process(postToProcess);

    expect(evaluator.evaluate).toHaveBeenCalledOnce();
    expect(telegram.sendToMe).toHaveBeenCalledOnce();
    expect(dedupeStore.isProcessed("-1001234567890:9")).toBe(true);
    dedupeStore.close();
  });
});
