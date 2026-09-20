import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { EvaluationFailure, Evaluator, RetryPolicy } from "./evaluator.js";
import type { Post, Telegram } from "./telegram.js";
import type { Watchlist } from "./watchlist.js";

import { openDedupeStore } from "./dedupe-store.js";
import { createEvaluator, formatEvaluationError } from "./evaluator.js";
import { createPostPipeline } from "./pipeline.js";

type GenerateResult = Awaited<
  ReturnType<
    Extract<
      NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doGenerate"],
      (options: never) => unknown
    >
  >
>;

const staticWatchlist: Watchlist = { channelIds: () => [-1_001_234_567_890] };

const usage = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 10, total: 10 },
  outputTokens: { reasoning: undefined, text: 5, total: 5 },
};

function post(id: number, text = "Flat for rent"): Post {
  return {
    chatId: -1_001_234_567_890,
    link: `https://t.me/example/${id}`,
    messageIds: [id],
    photos: [],
    text,
  };
}

function evaluatorFiles(): { promptPath: string; criteriaPath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
  const promptPath = path.join(directory, "prompt.md");
  const criteriaPath = path.join(directory, "criteria.md");
  writeFileSync(promptPath, "Prompt");
  writeFileSync(criteriaPath, "Criteria");
  return { criteriaPath, promptPath };
}

/** Never resolves: rejects when the signal aborts, or at once if it is missing or already aborted. */
function rejectWhenAborted(abortSignal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (abortSignal === undefined) {
      reject(new Error("abort signal was not provided"));
      return;
    }

    if (abortSignal.aborted) {
      reject(abortSignal.reason as Error);
      return;
    }

    abortSignal.addEventListener(
      "abort",
      () => {
        reject(abortSignal.reason as Error);
      },
      { once: true },
    );
  });
}

function retryPolicy(timeoutMs = 100): RetryPolicy {
  return { attempts: 3, backoffsMs: [0, 0], maxSteps: 8, timeoutMs };
}

function successModel(notes = "Looks good"): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ text: JSON.stringify({ match: true, notes }), type: "text" }],
      finishReason: { raw: undefined, unified: "stop" },
      usage,
      warnings: [],
    },
  });
}

describe("failure paths", () => {
  it("formats timeout causes, strips ANSI, uses the first line, and caps the message", () => {
    expect.hasAssertions();
    const timeout = new DOMException("timed out", "TimeoutError");
    expect(
      formatEvaluationError(
        new Error("\u001B[31mfirst line\u001B[0m\nsecond line", { cause: timeout }),
      ),
    ).toBe("timeout: first line");

    const longMessage = "x".repeat(250);
    expect(formatEvaluationError(new Error(longMessage))).toBe(`Error: ${"x".repeat(200)}`);
  });

  it("retries a persistent model failure and returns one evaluation failure", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: (): Promise<never> => Promise.reject(new Error("gateway failed")),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(1) })).resolves.toStrictEqual({
      error: "Error: gateway failed",
      kind: "evaluation-failure",
    } satisfies EvaluationFailure);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(consoleError).toHaveBeenCalledTimes(3);
    consoleError.mockRestore();
  });

  it("recovers when the next attempt succeeds", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: vi
        .fn<() => Promise<GenerateResult>>()
        .mockRejectedValueOnce(new Error("temporary gateway failure"))
        .mockResolvedValue({
          content: [{ text: JSON.stringify({ match: true, notes: "Recovered" }), type: "text" }],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        }),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(2) })).resolves.toStrictEqual({
      match: true,
      notes: "Recovered",
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    consoleError.mockRestore();
  });

  it("delivers a recovered Match through the pipeline", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: vi
        .fn<() => Promise<GenerateResult>>()
        .mockRejectedValueOnce(new Error("temporary gateway failure"))
        .mockResolvedValue({
          content: [{ text: JSON.stringify({ match: true, notes: "Recovered" }), type: "text" }],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        }),
    });
    const telegram = {
      sendToMe: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator: createEvaluator(
        { modelId: "test/model", ...files },
        { model, retryPolicy: retryPolicy() },
      ),
      telegram,
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(25));

    expect(telegram.sendToMe).toHaveBeenCalledWith("https://t.me/example/25\nRecovered");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("failed to send notification"),
      expect.anything(),
    );
    consoleError.mockRestore();
    log.mockRestore();
    dedupeStore.close();
  });

  it("counts a run with no output as a failed attempt", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [],
        finishReason: { raw: undefined, unified: "length" },
        usage,
        warnings: [],
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(3) })).resolves.toMatchObject({
      kind: "evaluation-failure",
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
  });

  it("counts a run with invalid structured output as a failed attempt", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ text: "not JSON", type: "text" }],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      { model, retryPolicy: retryPolicy() },
    );

    await expect(evaluator.evaluate({ ...post(30) })).resolves.toMatchObject({
      error: expect.stringContaining("AI_NoObjectGeneratedError") as string,
      kind: "evaluation-failure",
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
  });

  it("counts a timed-out run as a failed attempt", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }): Promise<never> => rejectWhenAborted(abortSignal),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(10),
      },
    );

    await expect(evaluator.evaluate({ ...post(31) })).resolves.toMatchObject({
      error: expect.stringMatching(/^timeout:/u) as string,
      kind: "evaluation-failure",
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
  });

  it("returns a prompt or Criteria read failure without an agent run or retry", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = successModel();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      {
        criteriaPath: path.join(tmpdir(), "missing-criteria.md"),
        modelId: "test/model",
        promptPath: files.promptPath,
      },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(4) })).resolves.toMatchObject({
      error: expect.stringContaining("Criteria file") as string,
      kind: "evaluation-failure",
    });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("sends one capped warning after persistent failure", async () => {
    expect.hasAssertions();
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: (): Promise<never> => Promise.reject(new Error("model unavailable")),
    });
    const telegram = {
      sendToMe: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator: createEvaluator(
        { modelId: "test/model", ...files },
        { model, retryPolicy: retryPolicy() },
      ),
      telegram,
      watchlist: staticWatchlist,
    });

    await pipeline.process(post(5));

    expect(telegram.sendToMe).toHaveBeenCalledTimes(1);
    expect(telegram.sendToMe).toHaveBeenCalledWith(
      "https://t.me/example/5\n⚠️ couldn't evaluate: Error: model unavailable",
    );
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
    log.mockRestore();
    dedupeStore.close();
  });

  it("logs a failed send, marks the Post, and continues with the next Post", async () => {
    expect.hasAssertions();
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi
        .fn<Evaluator["evaluate"]>()
        .mockResolvedValueOnce({ match: true, notes: "First" })
        .mockResolvedValueOnce({ match: true, notes: "Second" }),
    };
    const telegram = {
      sendToMe: vi
        .fn<Telegram["sendToMe"]>()
        .mockRejectedValueOnce(new Error("Saved Messages unavailable"))
        .mockResolvedValue(),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const pipeline = createPostPipeline({
      dedupeStore,
      evaluator,
      telegram,
      watchlist: staticWatchlist,
    });

    await Promise.all([pipeline.process(post(6)), pipeline.process(post(7))]);

    expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(1, "https://t.me/example/6\nFirst");
    expect(telegram.sendToMe).toHaveBeenNthCalledWith(2, "https://t.me/example/7\nSecond");
    expect(dedupeStore.isProcessed("-1001234567890:6")).toBe(true);
    expect(dedupeStore.isProcessed("-1001234567890:7")).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "post https://t.me/example/6: failed to send notification",
      expect.any(Error),
    );
    consoleError.mockRestore();
    log.mockRestore();
    dedupeStore.close();
  });
});
