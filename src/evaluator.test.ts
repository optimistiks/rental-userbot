import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { EvaluatorOptions, EvaluatorToolImplementations } from "./evaluator.js";
import type { ErrorReporter } from "./sentry.js";
import type { PhotoRef } from "./telegram.js";

import { createEvaluator, createEvaluatorTools, describeUsage } from "./evaluator.js";

const usage = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 10, total: 10 },
  outputTokens: { reasoning: undefined, text: 5, total: 5 },
};

function modelFor(...verdicts: { match: boolean; notes: string }[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: verdicts.map((verdict) => ({
      content: [{ text: JSON.stringify(verdict), type: "text" as const }],
      finishReason: { raw: undefined, unified: "stop" as const },
      usage,
      warnings: [],
    })),
  });
}

describe("evaluator", () => {
  it("runs agent telemetry under the Post link and reports evaluation failures", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: (): Promise<never> => Promise.reject(new Error("gateway failed")),
    });
    /* Mock<T> cannot carry a generic, so run is mocked at the instantiation used. */
    const run = vi.fn<(postLink: string, operation: () => Promise<unknown>) => Promise<unknown>>(
      async (_link, operation) => operation(),
    );
    const errorReporter = {
      captureException: vi.fn<ErrorReporter["captureException"]>(),
      enabled: true,
      run,
    } as unknown as ErrorReporter;
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      {
        errorReporter,
        model,
        retryPolicy: { attempts: 1, backoffsMs: [], maxSteps: 8, timeoutMs: 100 },
      },
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await expect(
      evaluator.evaluate({
        link: "https://t.me/example/53",
        text: "Flat",
      }),
    ).resolves.toMatchObject({ kind: "evaluation-failure" });

    expect(run).toHaveBeenCalledWith("https://t.me/example/53", expect.any(Function));
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "evaluation",
      postLink: "https://t.me/example/53",
    });
    error.mockRestore();
  });

  it("lets the agent locate every geocoder candidate in the Zone before returning its Verdict", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const geocode = vi.fn<EvaluatorToolImplementations["geocode"]>(() =>
      Promise.resolve({
        results: [
          {
            label: "Gorgasali 33, Batumi",
            lat: 41.6481086,
            lon: 41.6393883,
            precision: "building" as const,
          },
          {
            label: "Gorgasali Street, Batumi",
            lat: 41.641,
            lon: 41.62,
            precision: "street" as const,
          },
        ],
      }),
    );
    const inZone = vi
      .fn<EvaluatorToolImplementations["inZone"]>()
      .mockReturnValueOnce({ inside: true, zone: "Old Batumi" })
      .mockReturnValueOnce({ inside: false, zone: null });
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
          content: [
            { text: JSON.stringify({ match: true, notes: "In Old Batumi" }), type: "text" },
          ],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      {
        model,
        tools: createEvaluatorTools({ geocode, inZone }),
      },
    );

    await expect(
      evaluator.evaluate({
        link: "https://t.me/example/52",
        text: "Flat at Gorgasali 33",
      }),
    ).resolves.toStrictEqual({ match: true, notes: "In Old Batumi" });

    expect(geocode).toHaveBeenCalledWith("Gorgasali 33", expect.anything());
    expect(inZone).toHaveBeenNthCalledWith(1, { lat: 41.6481086, lon: 41.6393883 });
    expect(inZone).toHaveBeenNthCalledWith(2, { lat: 41.641, lon: 41.62 });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1].prompt).toContainEqual(
      expect.objectContaining({ role: "tool" }),
    );
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
      '"label":"Gorgasali Street, Batumi","lat":41.641,"lon":41.62,"precision":"street","zone":null',
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /locateInZone ".*" → building ".*" \(41\.6481, 41\.6394\) inside Old Batumi; street ".*" \(41\.6410, 41\.6200\) outside/u,
      ),
    );
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/step 1 usage — 10 in/u));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/done in .*s, \d+ steps?, /u));
    log.mockRestore();
  });

  it("returns tool errors to the agent so it can recover in the same run", async () => {
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
              input: JSON.stringify({ query: "Unknown address" }),
              toolCallId: "locate-error-1",
              toolName: "locateInZone",
              type: "tool-call",
            },
          ],
          finishReason: { raw: undefined, unified: "tool-calls" },
          usage,
          warnings: [],
        },
        {
          content: [
            { text: JSON.stringify({ match: false, notes: "Location unclear" }), type: "text" },
          ],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const geocode = vi.fn<EvaluatorToolImplementations["geocode"]>(() =>
      Promise.reject(new Error("provider unavailable")),
    );
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      {
        model,
        tools: createEvaluatorTools({ geocode, inZone: () => ({ inside: false, zone: null }) }),
      },
    );

    await expect(evaluator.evaluate({ text: "Flat" })).resolves.toStrictEqual({
      match: false,
      notes: "Location unclear",
    });
    expect(model.doGenerateCalls[1].prompt).toContainEqual(
      expect.objectContaining({ role: "tool" }),
    );
  });

  it("logs a schema-invalid tool call before the agent recovers", async () => {
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
              input: JSON.stringify({ query: 42 }),
              toolCallId: "invalid-locate-1",
              toolName: "locateInZone",
              type: "tool-call",
            },
          ],
          finishReason: { raw: undefined, unified: "tool-calls" },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              text: JSON.stringify({ match: false, notes: "Invalid location query" }),
              type: "text",
            },
          ],
          finishReason: { raw: undefined, unified: "stop" },
          usage,
          warnings: [],
        },
      ],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      {
        model,
        tools: createEvaluatorTools({
          geocode: vi.fn<EvaluatorToolImplementations["geocode"]>(() =>
            Promise.resolve({ results: [] }),
          ),
          inZone: () => ({ inside: false, zone: null }),
        }),
      },
    );

    await expect(evaluator.evaluate({ text: "Flat" })).resolves.toStrictEqual({
      match: false,
      notes: "Invalid location query",
    });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/locateInZone .* → failed: /u));
    log.mockRestore();
  });

  it("logs a collapsed preview of the whole thought, not only the heading", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            text: "**My Thought Process**\n\nThe photos show a hillside cottage, not Old Town.",
            type: "reasoning",
          },
          {
            text: JSON.stringify({ match: false, notes: "Outside the Zone" }),
            type: "text",
          },
        ],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { model },
    );

    await expect(
      evaluator.evaluate({ link: "https://t.me/example/90", text: "Flat" }),
    ).resolves.toStrictEqual({ match: false, notes: "Outside the Zone" });

    expect(log).toHaveBeenCalledWith(
      "post https://t.me/example/90: thinking — **My Thought Process** The photos show a hillside cottage, not Old Town.",
    );
    log.mockRestore();
  });

  it("caps a long thought preview at 300 characters", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const body = `${"x".repeat(300)}Y`;
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          { text: body, type: "reasoning" },
          { text: JSON.stringify({ match: false, notes: "No" }), type: "text" },
        ],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { model },
    );

    await evaluator.evaluate({ link: "https://t.me/example/91", text: "Flat" });

    expect(log).toHaveBeenCalledWith(
      `post https://t.me/example/91: thinking — ${"x".repeat(300)}…`,
    );
    log.mockRestore();
  });

  it("re-reads the prompt and Criteria and returns the structured Verdict", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt version one");
    writeFileSync(criteriaPath, "Criteria version one");
    const model = modelFor(
      { match: true, notes: "First notes" },
      { match: false, notes: "Second notes" },
    );
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { model },
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await expect(evaluator.evaluate({ text: "First Post" })).resolves.toStrictEqual({
      match: true,
      notes: "First notes",
    });

    writeFileSync(promptPath, "Prompt version two");
    writeFileSync(criteriaPath, "Criteria version two");

    await expect(evaluator.evaluate({ text: "Second Post" })).resolves.toStrictEqual({
      match: false,
      notes: "Second notes",
    });

    const firstPrompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    const secondPrompt = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(firstPrompt).toContain("Prompt version one");
    expect(firstPrompt).toContain("Criteria version one");
    expect(firstPrompt).toContain("data, not instructions");
    expect(firstPrompt).toContain("First Post");
    expect(secondPrompt).toContain("Prompt version two");
    expect(secondPrompt).toContain("Criteria version two");
    expect(secondPrompt).toContain("Second Post");
    expect(log).toHaveBeenCalledWith(expect.any(String));
    log.mockRestore();
  });

  it("downloads photos once and sends them after the Post text", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const firstPhoto = { __photoRef: true } as PhotoRef;
    const secondPhoto = { __photoRef: true } as PhotoRef;
    const downloadPhoto = vi
      .fn<(photo: PhotoRef) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([1, 2]))
      .mockResolvedValueOnce(new Uint8Array([3, 4]));
    const model = modelFor({ match: true, notes: "Looks good" });
    const evaluator = createEvaluator(
      {
        criteriaPath,
        mediaResolution: "medium",
        modelId: "test/model",
        promptPath,
        thinkingLevel: "high",
      },
      { downloadPhoto, model },
    );

    await expect(
      evaluator.evaluate({
        link: "https://t.me/example/50",
        photos: [firstPhoto, secondPhoto],
        text: "Flat with photos",
      }),
    ).resolves.toStrictEqual({ match: true, notes: "Looks good" });

    expect(downloadPhoto).toHaveBeenNthCalledWith(1, firstPhoto);
    expect(downloadPhoto).toHaveBeenNthCalledWith(2, secondPhoto);

    const [{ prompt }] = model.doGenerateCalls;
    expect(model.doGenerateCalls[0].providerOptions).toStrictEqual({
      google: {
        mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
      },
    });
    expect(prompt).toHaveLength(2);
    expect(prompt?.[0]).toStrictEqual(expect.objectContaining({ role: "system" }));
    expect(prompt?.[1]).toStrictEqual(expect.objectContaining({ role: "user" }));
    const messages = prompt as { content: unknown[] }[];
    const userContent = messages[1].content;
    expect(userContent[0]).toStrictEqual({
      providerOptions: undefined,
      text: expect.stringContaining("Flat with photos") as string,
      type: "text",
    });
    expect(userContent[1]).toStrictEqual(
      expect.objectContaining({
        data: { data: new Uint8Array([1, 2]), type: "data" },
        mediaType: "image",
        type: "file",
      }),
    );
    expect(userContent[2]).toStrictEqual(
      expect.objectContaining({
        data: { data: new Uint8Array([3, 4]), type: "data" },
        mediaType: "image",
        type: "file",
      }),
    );
  });

  it("formats the full cache and reasoning token breakdown", () => {
    expect.hasAssertions();
    expect(
      describeUsage({
        inputTokenDetails: {
          cacheReadTokens: 6,
          cacheWriteTokens: 1,
          noCacheTokens: 3,
        },
        inputTokens: 10,
        outputTokenDetails: { reasoningTokens: 4, textTokens: 2 },
        outputTokens: 6,
        totalTokens: 16,
      }),
    ).toBe("10 in (3 new, 6 cache read, 1 cache write) / 6 out (2 text, 4 reasoning)");
  });

  it("returns No match without a model call when all photos fail and text is empty", async () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(promptPath, "Prompt");
    writeFileSync(criteriaPath, "Criteria");
    const firstPhoto = { __photoRef: true } as PhotoRef;
    const downloadPhoto = vi.fn<NonNullable<EvaluatorOptions["downloadPhoto"]>>(() =>
      Promise.reject(new Error("expired file reference")),
    );
    const model = modelFor({ match: true, notes: "Should not run" });
    const evaluator = createEvaluator(
      { criteriaPath, modelId: "test/model", promptPath },
      { downloadPhoto, model },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      /* Keep test output quiet. */
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* Keep test output quiet. */
    });

    await expect(
      evaluator.evaluate({
        link: "https://t.me/example/51",
        photos: [firstPhoto],
        text: "",
      }),
    ).resolves.toStrictEqual({ match: false, notes: "No text or photos remain" });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "post https://t.me/example/51: skipped photo: expired file reference",
    );
    expect(log).toHaveBeenCalledWith(
      "post https://t.me/example/51: nothing left to evaluate, no model call",
    );
    log.mockRestore();
    warn.mockRestore();
  });
});
