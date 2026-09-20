import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Post } from "./telegram.js";

import { openDedupeStore } from "./dedupe-store.js";
import { createEvaluator, formatEvaluationError, type EvaluationFailure } from "./evaluator.js";
import { createPostPipeline } from "./pipeline.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function post(id: number, text = "Flat for rent"): Post {
  return {
    chatId: -1001234567890,
    messageIds: [id],
    text,
    photos: [],
    link: `https://t.me/example/${id}`,
  };
}

function evaluatorFiles(): { promptPath: string; criteriaPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "rental-userbot-"));
  const promptPath = join(directory, "prompt.md");
  const criteriaPath = join(directory, "criteria.md");
  writeFileSync(promptPath, "Prompt");
  writeFileSync(criteriaPath, "Criteria");
  return { promptPath, criteriaPath };
}

function retryPolicy(timeoutMs = 100) {
  return { attempts: 3, backoffsMs: [0, 0], timeoutMs, maxSteps: 8 };
}

function successModel(notes = "Looks good") {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({ match: true, notes }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
  });
}

describe("failure paths", () => {
  it("formats timeout causes, strips ANSI, uses the first line, and caps the message", () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    expect(
      formatEvaluationError(
        new Error("\u001b[31mfirst line\u001b[0m\nsecond line", { cause: timeout }),
      ),
    ).toBe("timeout: first line");

    const longMessage = "x".repeat(250);
    expect(formatEvaluationError(new Error(longMessage))).toBe(`Error: ${"x".repeat(200)}`);
  });

  it("retries a persistent model failure and returns one evaluation failure", async () => {
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("gateway failed");
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(1) })).resolves.toEqual({
      kind: "evaluation-failure",
      error: "Error: gateway failed",
    } satisfies EvaluationFailure);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(consoleError).toHaveBeenCalledTimes(3);
    consoleError.mockRestore();
  });

  it("recovers when the next attempt succeeds", async () => {
    const files = evaluatorFiles();
    let attempts = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary gateway failure");
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ match: true, notes: "Recovered" }) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(2) })).resolves.toEqual({
      match: true,
      notes: "Recovered",
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    consoleError.mockRestore();
  });

  it("delivers a recovered Match through the pipeline", async () => {
    const files = evaluatorFiles();
    let attempts = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary gateway failure");
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ match: true, notes: "Recovered" }) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const telegram = {
      sendToMe: vi.fn<(text: string) => Promise<void>>(async () => undefined),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator: createEvaluator(
        { modelId: "test/model", ...files },
        { model, retryPolicy: retryPolicy() },
      ),
      telegram,
      dedupeStore,
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
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [],
        finishReason: { unified: "length", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "not JSON" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      { model, retryPolicy: retryPolicy() },
    );

    await expect(evaluator.evaluate({ ...post(30) })).resolves.toMatchObject({
      kind: "evaluation-failure",
      error: expect.stringContaining("AI_NoObjectGeneratedError"),
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
  });

  it("counts a timed-out run as a failed attempt", async () => {
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise<never>((_, reject) => {
          if (abortSignal === undefined) {
            reject(new Error("abort signal was not provided"));
            return;
          }

          if (abortSignal.aborted) {
            reject(abortSignal.reason);
            return;
          }

          abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
        }),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const evaluator = createEvaluator(
      { modelId: "test/model", ...files },
      {
        model,
        retryPolicy: retryPolicy(10),
      },
    );

    await expect(evaluator.evaluate({ ...post(31) })).resolves.toMatchObject({
      kind: "evaluation-failure",
      error: expect.stringMatching(/^timeout:/),
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
  });

  it("returns a prompt or Criteria read failure without an agent run or retry", async () => {
    const files = evaluatorFiles();
    const model = successModel();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const evaluator = createEvaluator(
      {
        modelId: "test/model",
        promptPath: files.promptPath,
        criteriaPath: join(tmpdir(), "missing-criteria.md"),
      },
      {
        model,
        retryPolicy: retryPolicy(),
      },
    );

    await expect(evaluator.evaluate({ ...post(4) })).resolves.toMatchObject({
      kind: "evaluation-failure",
      error: expect.stringContaining("Criteria file"),
    });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("sends one capped warning after persistent failure", async () => {
    const files = evaluatorFiles();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("model unavailable");
      },
    });
    const telegram = {
      sendToMe: vi.fn<(text: string) => Promise<void>>(async () => undefined),
    };
    const dedupeStore = openDedupeStore(":memory:");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator: createEvaluator(
        { modelId: "test/model", ...files },
        { model, retryPolicy: retryPolicy() },
      ),
      telegram,
      dedupeStore,
    });

    await pipeline.process(post(5));

    expect(telegram.sendToMe).toHaveBeenCalledOnce();
    expect(telegram.sendToMe).toHaveBeenCalledWith(
      "https://t.me/example/5\n⚠️ couldn't evaluate: Error: model unavailable",
    );
    expect(model.doGenerateCalls).toHaveLength(3);
    consoleError.mockRestore();
    log.mockRestore();
    dedupeStore.close();
  });

  it("logs a failed send, marks the Post, and continues with the next Post", async () => {
    const dedupeStore = openDedupeStore(":memory:");
    const evaluator = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({ match: true, notes: "First" })
        .mockResolvedValueOnce({ match: true, notes: "Second" }),
    };
    let sendCount = 0;
    const telegram = {
      sendToMe: vi.fn(async () => {
        sendCount += 1;
        if (sendCount === 1) {
          throw new Error("Saved Messages unavailable");
        }
      }),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
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

  it("caps a Match notification at Telegram’s 4096-character limit", async () => {
    const dedupeStore = openDedupeStore(":memory:");
    const telegram = {
      sendToMe: vi.fn<(text: string) => Promise<void>>(async () => undefined),
    };
    const evaluator = {
      evaluate: vi.fn(async () => ({ match: true, notes: "x".repeat(5000) })),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    });

    await pipeline.process(post(8));

    expect(telegram.sendToMe).toHaveBeenCalledOnce();
    expect(telegram.sendToMe.mock.calls[0]?.[0]).toHaveLength(4096);
    log.mockRestore();
    dedupeStore.close();
  });
});
