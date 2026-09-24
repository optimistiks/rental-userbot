import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import type { EvaluationFailure, RetryPolicy } from "./evaluator.js";
import type { Locator } from "./locate.js";
import type { ErrorReporter } from "./sentry.js";
import type { PhotoRef } from "./telegram.js";

import {
  ownerFileContents,
  post,
  quiet,
  testEvaluator,
  testSettings,
  usage,
  verdictModel,
} from "./test-support.js";

type GenerateResult = Awaited<
  ReturnType<
    Extract<
      NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doGenerate"],
      (options: never) => unknown
    >
  >
>;

/** The agent asks to locate `query`, then answers with `verdict`. */
function locatingModel(
  query: string,
  verdict: { match: boolean; notes: string },
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            input: JSON.stringify({ query }),
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
        content: [{ text: JSON.stringify(verdict), type: "text" }],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      },
    ],
  });
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

describe("evaluator", () => {
  it("runs agent telemetry under the Post link and reports evaluation failures", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
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
    const evaluator = testEvaluator(model, {
      errorReporter,
      retryPolicy: { attempts: 1, backoffsMs: [], maxSteps: 8, timeoutMs: 100 },
    });

    await expect(evaluator.evaluate(post(53), ownerFileContents())).resolves.toMatchObject({
      kind: "evaluation-failure",
    });

    expect(run).toHaveBeenCalledWith("https://t.me/example/53", expect.any(Function));
    expect(errorReporter.captureException).toHaveBeenCalledWith(expect.any(Error), {
      phase: "evaluation",
      postLink: "https://t.me/example/53",
    });
  });

  it("lets the agent locate a place in this Post's Zone before returning its Verdict", async () => {
    expect.hasAssertions();
    const log = quiet("log");
    const locate = vi.fn<Locator["locate"]>(() =>
      Promise.resolve([
        {
          inside: true,
          label: "Gorgasali 33, Batumi",
          lat: 41.6481086,
          lon: 41.6393883,
          precision: "building" as const,
          zone: "Old Batumi",
        },
        {
          inside: false,
          label: "Gorgasali Street, Batumi",
          lat: 41.641,
          lon: 41.62,
          precision: "street" as const,
          zone: null,
        },
      ]),
    );
    const ownerFiles = ownerFileContents();
    const model = locatingModel("Gorgasali 33", { match: true, notes: "In Old Batumi" });
    const evaluator = testEvaluator(model, { locator: { locate } });

    await expect(
      evaluator.evaluate(post(52, { text: "Flat at Gorgasali 33" }), ownerFiles),
    ).resolves.toStrictEqual({ match: true, notes: "In Old Batumi" });

    expect(locate).toHaveBeenCalledWith("Gorgasali 33", ownerFiles.zone, expect.anything());
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
      '"label":"Gorgasali Street, Batumi","lat":41.641,"lon":41.62,"precision":"street","zone":null',
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^post https:\/\/t\.me\/example\/52: locateInZone "Gorgasali 33" → building .* inside Old Batumi; street .* outside in \d+ms$/u,
      ),
    );
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/step 1 usage — 10 in/u));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/done in .*s, \d+ steps?, /u));
  });

  it("returns tool errors to the agent so it can recover in the same run", async () => {
    expect.hasAssertions();
    quiet("log");
    const model = locatingModel("Unknown address", { match: false, notes: "Location unclear" });
    const evaluator = testEvaluator(model, {
      locator: { locate: () => Promise.reject(new Error("provider unavailable")) },
    });

    await expect(evaluator.evaluate(post(1), ownerFileContents())).resolves.toStrictEqual({
      match: false,
      notes: "Location unclear",
    });
    expect(model.doGenerateCalls[1].prompt).toContainEqual(
      expect.objectContaining({ role: "tool" }),
    );
  });

  it("judges against the Prompt and Criteria it is given for this Post", async () => {
    expect.hasAssertions();
    quiet("log");
    const model = verdictModel(
      { match: true, notes: "First notes" },
      { match: false, notes: "Second notes" },
    );
    const evaluator = testEvaluator(model);

    await expect(
      evaluator.evaluate(
        post(1, { text: "First Post" }),
        ownerFileContents({ criteria: "Criteria version one", prompt: "Prompt version one" }),
      ),
    ).resolves.toStrictEqual({ match: true, notes: "First notes" });
    await expect(
      evaluator.evaluate(
        post(2, { text: "Second Post" }),
        ownerFileContents({ criteria: "Criteria version two", prompt: "Prompt version two" }),
      ),
    ).resolves.toStrictEqual({ match: false, notes: "Second notes" });

    const firstPrompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    const secondPrompt = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(firstPrompt).toContain("Prompt version one");
    expect(firstPrompt).toContain("Criteria version one");
    expect(firstPrompt).toContain("data, not instructions");
    expect(firstPrompt).toContain("First Post");
    expect(secondPrompt).toContain("Prompt version two");
    expect(secondPrompt).toContain("Criteria version two");
    expect(secondPrompt).toContain("Second Post");
  });

  it("downloads photos once and sends them after the Post text", async () => {
    expect.hasAssertions();
    quiet("log");
    const downloadPhoto = vi
      .fn<(photo: PhotoRef) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([1, 2]))
      .mockResolvedValueOnce(new Uint8Array([3, 4]));
    const model = verdictModel({ match: true, notes: "Looks good" });
    const evaluator = testEvaluator(
      model,
      { downloadPhoto },
      { ...testSettings(), mediaResolution: "medium", thinkingLevel: "high" },
    );

    await expect(
      evaluator.evaluate(
        post(50, { photos: ["first", "second"], text: "Flat with photos" }),
        ownerFileContents(),
      ),
    ).resolves.toStrictEqual({ match: true, notes: "Looks good" });

    expect(downloadPhoto).toHaveBeenNthCalledWith(1, "first");
    expect(downloadPhoto).toHaveBeenNthCalledWith(2, "second");

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
    expect(userContent.slice(1)).toStrictEqual([
      expect.objectContaining({
        data: { data: new Uint8Array([1, 2]), type: "data" },
        mediaType: "image",
      }),
      expect.objectContaining({
        data: { data: new Uint8Array([3, 4]), type: "data" },
        mediaType: "image",
      }),
    ]);
  });
});

describe("evaluation failures", () => {
  it("retries a persistent model failure and returns one evaluation failure", async () => {
    expect.hasAssertions();
    const consoleError = quiet("error");
    quiet("log");
    const model = new MockLanguageModelV4({
      doGenerate: (): Promise<never> => Promise.reject(new Error("gateway failed")),
    });

    await expect(
      testEvaluator(model, { retryPolicy: retryPolicy() }).evaluate(post(1), ownerFileContents()),
    ).resolves.toStrictEqual({
      error: "Error: gateway failed",
      kind: "evaluation-failure",
    } satisfies EvaluationFailure);
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(consoleError).toHaveBeenCalledTimes(3);
  });

  it("recovers when the next attempt succeeds", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
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

    await expect(
      testEvaluator(model, { retryPolicy: retryPolicy() }).evaluate(post(2), ownerFileContents()),
    ).resolves.toStrictEqual({ match: true, notes: "Recovered" });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it.each([
    ["a run with no output", { content: [], unified: "length" as const }, "evaluation-failure"],
    [
      "a run with invalid structured output",
      { content: [{ text: "not JSON", type: "text" as const }], unified: "stop" as const },
      "AI_NoObjectGeneratedError",
    ],
  ])("counts %s as a failed attempt", async (_case, { content, unified }, expected) => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
    const model = new MockLanguageModelV4({
      doGenerate: { content, finishReason: { raw: undefined, unified }, usage, warnings: [] },
    });

    const verdict = await testEvaluator(model, { retryPolicy: retryPolicy() }).evaluate(
      post(3),
      ownerFileContents(),
    );

    expect(JSON.stringify(verdict)).toContain(expected);
    expect(model.doGenerateCalls).toHaveLength(3);
  });

  it("counts a timed-out run as a failed attempt", async () => {
    expect.hasAssertions();
    quiet("error");
    quiet("log");
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }): Promise<never> => rejectWhenAborted(abortSignal),
    });

    await expect(
      testEvaluator(model, { retryPolicy: retryPolicy(10) }).evaluate(
        post(31),
        ownerFileContents(),
      ),
    ).resolves.toMatchObject({
      error: expect.stringMatching(/^timeout:/u) as string,
      kind: "evaluation-failure",
    });
    expect(model.doGenerateCalls).toHaveLength(3);
  });
});
