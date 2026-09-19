# Research: an agentic Evaluator on `ai@7.0.107` + Gemini 3.8 Flash

Researched 2026-09-20 for ticket `issues/21-agentic-evaluator-facts.md`. This builds on `research/ai-gateway.md` (model choice, pricing, image parts, `maxRetries: 0`, gateway error classes, msw fixtures). None of that is repeated here.

**Sources.** npm tarballs unpacked with `npm pack`: `ai@7.0.107`, `@ai-sdk/gateway@4.0.87` (the version `ai` pins), `@ai-sdk/provider-utils@5.0.45`, `@ai-sdk/provider@4.0.17`, and `@ai-sdk/google@4.0.76` (latest on 2026-09-20). Paths like `ai: src/...` point into those tarballs. Also used: the docs shipped in the `ai` tarball (`ai: docs/...`, the same content as ai-sdk.dev), the Google Gemini API docs, and vercel/ai GitHub issues.

**Evidence tags.**
- **[src]**: verified by reading the published source.
- **[docs]**: read in official docs.
- **[issue]**: from a vercel/ai GitHub issue thread.
- **[inferred]**: my reasoning, not verified.

No live gateway calls were made.

## Short answers

1. **Tools + multi-step + `Output.object` in one `generateText`: yes, it is supported.** The structured output is parsed only from the **last step**, after the tool steps.
   - Gemini 3 accepts function calling together with a JSON response schema ("available only to Gemini 3 series models" per Google). The `@ai-sdk/google` provider sends `tools` and `responseJsonSchema` in the same request with no warning.
   - **Caveats:**
     - `responseFormat` is sent on **every** step, including tool steps.
     - If the loop stops on a step whose finish reason is `tool-calls` (for example, the step cap is hit), `result.output` **throws `NoOutputGeneratedError`**.
     - Users have reported intermittent `NoOutputGeneratedError` on Gemini 3 with tools + `Output.object`.
   - **Recommendation:** use `tools` + `Output.object` + `stopWhen: isStepCount(N)`. In `prepareStep`, set `toolChoice: 'none'` on the last allowed step so that step must produce the JSON. Catch `NoOutputGeneratedError` and `NoObjectGeneratedError` as a "bad-output" failure.
   - **Fallback:** a final `submitVerdict` tool with no `execute`, plus `toolChoice: 'required'`. The verdict is then read from `result.staticToolCalls`.
2. **Tool API:** `tool({ description, inputSchema: z.object(...), execute: async (input, { toolCallId, messages, abortSignal, context }) => ... })`. Optional fields include `strict`, `inputExamples`, `toModelOutput`, `title` and `needsApproval`.
   - **A thrown error in `execute`** becomes a `tool-error` content part. The model receives it as a tool result `{ type: 'error-text', value: <error message> }` and the loop **continues**.
   - **A returned `{ error: ... }` object** is an ordinary successful result, sent as `{ type: 'json', value }`. The SDK does not treat it as an error.
   - **Invalid tool input from the model** (fails zod) is also turned into a `tool-error` and sent back. It does not throw.
3. **Stop conditions:** `stepCountIs` was renamed to **`isStepCount`**. The old name is still exported as an alias. The default is `isStepCount(1)`.
   - **Timeouts:** `timeout: number` is a **total** timeout for the whole run, including tool execution. `abortSignal` also covers the whole run.
   - **A per-step timeout exists:** `timeout: { stepMs }`. Its timer restarts each step and covers the model call plus that step's tool execution. **When it fires, the whole run aborts**, not just that step.
   - Also available: `timeout: { totalMs, stepMs, toolMs, tools: { geocodeMs } }`.
   - `maxRetries` applies to **each model call** within a step.
4. **Images are resent on every step.** Each step sends the full history again: instructions, the user message with all images, and every earlier assistant tool call and tool result. Input tokens therefore grow roughly linearly with the number of steps.
   - With 6 images (about 6.7k tokens) and 3 steps, that is about 25k input tokens instead of about 8.5k.
   - Gemini implicit caching (on by default, prefix ≥ 4,096 tokens for 3.x Flash) should bill most of the repeat at the cached rate. Hits are not guaranteed, and this was not measured through the gateway.
5. **Test mock:** `MockLanguageModelV4` from `ai/test`. Pass `doGenerate` as an **array** of results and call *n* returns element *n*. Tool-call content uses `input` as a **JSON string**. Example below.
6. **Step trace:** `result.steps[]`. Each step has `stepNumber`, `finishReason`, `toolCalls`, `toolResults`, `content` (which includes `tool-error` parts), `usage`, `performance` (`stepTimeMs`, `responseTimeMs`, `toolExecutionMs[toolCallId]`), `warnings` and `response`.
   - In v7, **`result.usage` equals `result.totalUsage`**, the sum over all steps.
   - `onStepEnd` gives the same data live, step by step.

---

## Q1. Tools + multi-step + structured output

### What `generateText` does ([src] `ai: src/generate-text/generate-text.ts`)

- **Every step sends the output schema.** Each step calls `stepModel.doGenerate({ ...stepCallSettings, tools: stepTools, toolChoice: stepToolChoice, responseFormat: await output?.responseFormat, prompt, ... })` (~L1041–1053). So `responseFormat: { type: 'json', schema }` goes out **together with `tools` on every step**, not only on the last one.
- **When the loop continues** (~L1508–1516): only when all client tool calls got outputs, **and** there was at least one client tool call, **and** no stop condition is met. So a step with no tool calls always ends the loop.
- **When the output is parsed** (~L1588–1606): after the loop, only if `lastStep.finishReason === 'stop'`, or if the last step is not `tool-calls` and has text. It parses `lastStep.text` only. Otherwise `resolvedOutput` stays `undefined`, and the `result.output` getter throws `NoOutputGeneratedError` (~L1794–1799).
  - **Consequence:** if `isStepCount(N)` stops the loop on a step where the model called tools again, there is **no output**. You get `NoOutputGeneratedError`, not a partial verdict.
- The docs agree [docs] (`ai: docs/03-ai-sdk-core/10-generating-structured-data.mdx`, "Generating Structured Outputs with Tools"):
  - "you can combine it with tool calling in the same request"
  - "generating the structured output counts as a step. Configure `stopWhen` to allow enough steps for both tool execution and output generation."
  - The doc example uses `tools` + `Output.object` + `stopWhen: isStepCount(5)`.

### Does Gemini accept function calling + JSON schema?

- **Google [docs]** (https://ai.google.dev/gemini-api/docs/structured-output, "Structured outputs with tools", page updated 2026-09-17):
  - "Gemini 3 lets you combine Structured Outputs with built-in tools, including Grounding with Google Search, URL Context, Code Execution, File Search, and Function Calling."
  - The note says: "This feature is available only to Gemini 3 series models."
  - `gemini-3.8-flash` is Gemini 3 series. **[inferred]** It is covered, though Google does not list 3.8 by name in that section.
- **Pre-Gemini-3 models reject it** [issue]: vercel/ai#11947 (closed 2026-01-22). Gemini 2.5 fails with `Function calling with a response mime type: 'application/json' is unsupported`. The maintainer answered that the combination is Gemini 3 only.
- **`@ai-sdk/google@4.0.76` [src]** (`src/google-language-model.ts` ~L394–425) builds `generationConfig.responseMimeType: 'application/json'` and `responseJsonSchema: sanitizeResponseJsonSchema(schema)` in the **same** request body as `tools` / `toolConfig`. It emits no warning or rejection for that combination.
  - Model detection: `getGoogleModelCapabilities` treats any Gemini ID that is not 1.x or 2.x as `usesGemini3Features` (`src/google-model-capabilities.ts`).
- **Through the gateway:**
  - [src] `GatewayLanguageModel.getArgs` forwards the whole `LanguageModelV4CallOptions` (`tools`, `toolChoice`, `responseFormat`, `prompt`) and only strips `abortSignal` (`gateway: src/gateway-language-model.ts`).
  - [inferred] The gateway server then runs the Google or Vertex provider. The exact server-side provider version is not public, so "the gateway accepts it" is inferred from the protocol, not observed.
- **Thought signatures across steps:**
  - Gemini 3 needs the `thoughtSignature` of earlier function calls replayed.
  - [src] The Google provider returns it in `providerMetadata` on the tool-call part. `ai` copies `providerMetadata` into the next step's `providerOptions` via `toResponseMessages`.
  - The converter reads it under `google`, and also under `vertex`/`googleVertex` as a "gateway interop" fallback. If the signature is missing, it injects Google's documented sentinel `skip_thought_signature_validator` (`google: src/convert-to-google-messages.ts` ~L23–29, ~L236–255, ~L470–515).
  - So multi-step works without us handling signatures, even if the gateway routes consecutive steps to different backends. **[inferred]** from the fallback code.

### Known problems [issue]

- **vercel/ai#11466** (closed 2026-01-07): `NoOutputGeneratedError` with Gemini 3 + built-in tools + `Output.object`. Later comments on ai 6.0.100 / google-vertex 4.0.63 report "intermittent `AI_NoOutputGeneratedError` with `gemini-3.1-pro-preview` when output is set to `Output.object` and call also includes `tools`".
  - Not reproduced here.
  - It fits the parsing rule above: a last step that ends in `tool-calls`, or with empty text, yields no output.
- **vercel/ai#11396** (closed 2025-12-25): Gemini 3 preview emitted internal `{ "thought": ..., "call": ... }` JSON as text when tools were present. Google rolled it back. One commenter says a variant still appeared in March 2026.
  - For us, this would surface as `NoObjectGeneratedError` (schema mismatch).

### Recommended pattern

This combines [src]-verified mechanics with [inferred] design.

- `prepareStep` runs before every step and can return `toolChoice`, `activeTools`, `messages`, `instructions`, `providerOptions` and more ([src] `generate-text.ts` ~L889–960).
- Forcing `toolChoice: 'none'` on the last allowed step guarantees that step has no tool calls. Its finish reason is then `stop` and its text is parsed as the schema.
- That removes the "stopped mid-tool-loop, no output" failure.

```ts
import { generateText, Output, tool, isStepCount, NoOutputGeneratedError, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';

const MAX_STEPS = 4; // e.g. geocode, inZone, (one spare), final JSON

const Verdict = z.object({
  match: z.boolean(),
  reason: z.string(),
  note: z.string(),
});

const result = await generateText({
  model: 'google/gemini-3.8-flash',
  maxRetries: 0,
  timeout: { totalMs: 90_000, stepMs: 45_000, toolMs: 10_000 },
  instructions: criteriaText,
  messages: [{ role: 'user', content: [{ type: 'text', text: postText }, ...imageParts] }],
  tools: { geocode, inZone },
  output: Output.object({ schema: Verdict }),
  stopWhen: isStepCount(MAX_STEPS),
  prepareStep: ({ stepNumber }) =>
    stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' } : undefined,
});
const verdict = result.output; // throws NoOutputGeneratedError if the last step was not a final answer
```

**Fallback if Gemini misbehaves with `responseJsonSchema` + tools** (not needed unless live testing shows problems):

- Drop `output`.
- Add a `submitVerdict` tool whose `inputSchema` is the verdict schema and which has **no `execute`**. [src] A tool without `execute` produces no client output, so the loop stops right after that step (`stop-condition.ts` doc comment: "A tool without an execute function is called").
- Use `toolChoice: 'required'`, which maps to Gemini `mode: 'ANY'` ([src] `google-prepare-tools.ts` ~L282–298), so every step is a function call.
- Read the verdict from `result.staticToolCalls.find(c => c.toolName === 'submitVerdict')?.input`. The input is already zod-validated, or the call is marked invalid if parsing failed.
- Add `strict: true` on tools to make the Google provider use `functionCallingConfig.mode: 'VALIDATED'` ([src] `google-prepare-tools.ts` ~L240–271). Google describes VALIDATED as "Model ensures function schema adherence" [docs] (https://ai.google.dev/gemini-api/docs/function-calling).

## Q2. Tool definitions and errors

- **Shape** [src] `provider-utils: src/types/tool.ts` and `dist/index.d.ts` `ToolExecutionOptions`:
  - `description?`
  - `inputSchema` (required; zod 4 is accepted as a `FlexibleSchema`)
  - `execute?(input, options)`, where `options` = `{ toolCallId, messages, abortSignal?, context, experimental_sandbox? }`
  - `outputSchema?`, `strict?`, `inputExamples?`, `toModelOutput?`, `title?`, `needsApproval?`, `contextSchema?`, `providerOptions?`
  - Callbacks: `onInputStart`, `onInputDelta`, `onInputAvailable`
  - The docs example is `tool({ description, inputSchema: z.object({ location: z.string() }), execute: async ({ location }) => ... })` [docs] (`ai: docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx`).
- **`abortSignal` passed to `execute`** is the run's merged signal (caller `abortSignal`, total timeout, step timeout) merged again with the per-tool timeout from `timeout.toolMs` / `timeout.tools.<name>Ms` ([src] `execute-tool-call.ts`: `mergeAbortSignals(abortSignal, toolTimeoutMs)`).
  - Pass it to `fetch` inside `geocode`, or the tool will not actually be cancelled.
- **A thrown error in `execute`** [src]:
  - `execute-tool-call.ts` catches it and returns `{ type: 'tool-error', toolCallId, toolName, input, error }`. It does **not** rethrow.
  - `to-response-messages.ts` (~L185–200) turns it into a `tool` message part `tool-result` with `output = createToolModelOutput({ errorMode: 'text' })`, which gives `{ type: 'error-text', value: getErrorMessage(error) }`.
  - So the model sees the error **message string** as the function response, and the loop continues.
  - The step result keeps the original `error` object in `step.content` (`type: 'tool-error'`), not in `step.toolResults`.
- **Returning `{ error: 'not found' }`** is a normal result. `createToolModelOutput` gives `{ type: 'json', value }`, or `{ type: 'text' }` for a string return [src]. It appears in `toolResults`.
  - [inferred] For expected misses such as "geocoder found nothing", prefer returning a value like `{ found: false }`. Keep throwing for real faults, so that logs can separate the two (`tool-error` vs `tool-result`).
- **Invalid input or an unknown tool from the model** [src] `parse-tool-call.ts` ~L47–115:
  - A zod failure (`InvalidToolInputError`) or `NoSuchToolError`, with no `repairToolCall` configured, gives a tool call marked `invalid: true, dynamic: true, error`.
  - `generate-text.ts` ~L1298–1318 then adds a `tool-error` with `getErrorMessage(error)`.
  - So the model is told its arguments were invalid and can retry within the step budget. Nothing is thrown.

## Q3. `stopWhen`, `timeout`, `abortSignal`

**`stopWhen`** [src] `stop-condition.ts`, `dist/index.d.ts`:

- `isStepCount(n)` (true when `steps.length === n`), `hasToolCall(...names)` and `isLoopFinished()`.
- Accepts a single condition or an array; the array is OR-ed.
- The default for `generateText` is `isStepCount(1)`, which means no tool loop unless you set it. `ToolLoopAgent` defaults to `isStepCount(20)`.
- `stepCountIs` is still exported as an alias (`isStepCount as stepCountIs`). The 7.0 migration guide renames it [docs] (`docs/08-migration-guides/23-migration-guide-7-0.mdx` "Stop Condition Helper Rename").
- A "step" is one model call plus the tools it triggered. N steps means at most N model calls.

**`timeout`** [src] `ai: src/prompt/request-options.ts`, `generate-text.ts` ~L597–636, ~L866–876, ~L1500–1506:

| form | meaning |
|---|---|
| `timeout: 60_000` | **total**, the same as `{ totalMs: 60_000 }`. Implemented as `AbortSignal.timeout(ms)` created once at the start, merged with `abortSignal`. Covers every model call **and** tool execution. |
| `{ stepMs }` | A timer started at the beginning of each step and cleared in `finally` after that step's tools finish, so it restarts every step. It covers `prepareStep`, the model call, retries of that call and tool execution. **It aborts a single shared `AbortController` that is merged into the run signal, so a step timeout aborts the whole `generateText`.** It does not skip or retry just that step. |
| `{ toolMs }`, `{ tools: { geocodeMs } }` | Per tool execution. Merged only into the tool's `abortSignal`. When it fires, the tool (if it honours the signal) throws, which becomes a `tool-error` for the model. The run continues. |
| `{ firstChunkMs, chunkMs }` | Streaming only. `generateText` logs an "unsupported" warning. |

**`abortSignal`** is merged into the same run signal, so it is a whole-run cancel [src].

**Where an abort surfaces** [src + inferred]:

- During the HTTP call, it surfaces as the gateway error described in `ai-gateway.md`: `GatewayResponseError` with `cause.name === 'TimeoutError'`.
- Between steps, `mergedAbortSignal.throwIfAborted()` (~L867) throws the `DOMException` itself. Its message is `Step timeout of Nms exceeded` for `stepMs`.
- If a tool ignores its signal, the step waits for the tool to finish, and the abort surfaces at the next step boundary.
- So the existing `hasCause(name === 'TimeoutError')` classifier still works, as long as it also checks the top-level error itself (the loop starts at `c = e`, so it does).

**`maxRetries`** is applied through `retry(...)` around **each** `doGenerate` [src ~L1039]. With `maxRetries: 0`, one step means one HTTP call.

## Q4. Token cost of the step history

- **Resent every step** [src] `generate-text.ts` ~L858–860 and ~L1487–1488: `messagesForNextStep = [...stepMessages, ...stepResponseMessages]`. Each step re-converts and resends the **entire** conversation:
  - the instructions
  - the original user message with all file parts (images are re-encoded to base64 each time by the gateway provider)
  - every earlier assistant message (tool calls, text, reasoning parts if any)
  - every tool message
- **Reasoning:** reasoning parts are replayed as `thought: true` parts with their signatures ([src] `convert-to-google-messages.ts` ~L369–377). Gemini only returns thought *text* when `includeThoughts` is on, so by default the replay is mostly signatures. **[inferred]**
- **Estimate** [inferred arithmetic, using the prices and image counts in `ai-gateway.md`]:
  - One step with 6 photos at default resolution costs about 6.7k image tokens + about 1.5k text ≈ 8.5k input tokens.
  - A 3-step run (geocode → inZone → verdict) costs about 8.5k + 8.7k + 8.9k ≈ **26k input tokens**, about **$0.02** at $0.75/M.
  - Output (including thinking) is billed per step too, so expect 2–3 times the output tokens of the single-call design.
- **Implicit caching** [docs] (https://ai.google.dev/gemini-api/docs/caching, updated 2026-09-02):
  - "Implicit caching is enabled by default for all Gemini 2.5 and newer models."
  - The minimum is 4,096 tokens for the Gemini 3.x Flash models.
  - Advice: "putting large and common contents at the beginning of your prompt" and sending similar prefixes "in a short amount of time".
  - Our steps share a large identical prefix (instructions + images) and follow each other within seconds, so steps 2..N should mostly hit. Cached reads are $0.075/M (`ai-gateway.md` pricing table), so a hit makes the repeat nearly free.
  - **Not verified** that implicit caching applies through the gateway, or on the Vertex route. Check `step.usage.inputTokenDetails.cacheReadTokens` in the logs once live.
- **Levers** [src]:
  - `prepareStep` can return different `messages` per step, for example to strip image parts after step 0. This only makes sense if the verdict does not need the photos after the tools run, and it would also break the cached prefix.
  - Keep `stopWhen` small.
  - Setting `providerOptions.google.mediaResolution` through the gateway is still unverified (see `ai-gateway.md`).

## Q5. Testing with `ai/test`

- **Class and exports** [src] `ai: src/test/mock-language-model-v4.ts`, `dist/test/index.d.ts`: `MockLanguageModelV4`. The V3 mock and the helpers `mockValues`, `simulateReadableStream`, `convertArrayToReadableStream` and `mockId` are also exported.
- **`doGenerate`** can be:
  - a function `(options) => result`
  - a single result
  - **an array of results**, where call *n* returns `array[n-1]`
- Every call's options are recorded in `model.doGenerateCalls`, which lets a test check that step 2 received the tool result or that `responseFormat` was set.
- **Content parts:** a `LanguageModelV4ToolCall` has `input: string`, a JSON **string** ([src] `@ai-sdk/provider@4.0.17 src/language-model/v4/language-model-v4-tool-call.ts`).
- **Finish reason:** `finishReason` is `{ unified, raw }`.
- The docs example for a tool loop is at [docs] `ai: docs/03-ai-sdk-core/55-testing.mdx` "ToolLoopAgent".

```ts
import { generateText, Output, tool, isStepCount } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { it, expect } from 'vitest';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

it('geocodes, then returns a verdict', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      { // step 0: model calls a tool
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'geocode', input: '{"query":"Tverskaya 1"}' }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage, warnings: [],
      },
      { // step 1: final structured answer
        content: [{ type: 'text', text: JSON.stringify({ match: true, reason: 'in zone', note: '' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage, warnings: [],
      },
    ],
  });

  const geocode = tool({
    description: 'Geocode an address',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => ({ lat: 55.76, lon: 37.61, query }),
  });

  const result = await generateText({
    model,
    tools: { geocode },
    output: Output.object({ schema: z.object({ match: z.boolean(), reason: z.string(), note: z.string() }) }),
    stopWhen: isStepCount(4),
    prompt: 'post text',
  });

  expect(result.output).toEqual({ match: true, reason: 'in zone', note: '' });
  expect(result.steps).toHaveLength(2);
  expect(result.steps[0].toolResults[0].output).toMatchObject({ lat: 55.76 });
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(model.doGenerateCalls[0].responseFormat?.type).toBe('json');     // sent on tool steps too
  expect(model.doGenerateCalls[1].prompt.at(-1)?.role).toBe('tool');      // tool result fed back
});
```

**[inferred]** Not executed here. It is written against the verified types and the docs example. The msw approach from `ai-gateway.md` still works for multi-step runs: return a different body per request, for example with a counter in the handler. It exercises the real gateway wire format.

## Q6. Reading the step trace

[src] `ai: src/generate-text/step-result.ts` and `DefaultGenerateTextResult` in `generate-text.ts` ~L1687–1800.

**`result.steps: StepResult[]`.** Each step has:

- `stepNumber`, `callId`, `model: { provider, modelId }`
- `finishReason`, `rawFinishReason`
- `text`, `reasoningText`
- `content`: all parts, including `tool-call`, `tool-result` and **`tool-error`**
- `toolCalls` / `staticToolCalls` (input, typed)
- `toolResults` / `staticToolResults` (**successes only**)
- `usage: LanguageModelUsage`: `inputTokens`, `inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`, `outputTokens`, `outputTokenDetails.{textTokens, reasoningTokens}`, `totalTokens`
- `performance`: `stepTimeMs`, `responseTimeMs`, `toolExecutionMs: Record<toolCallId, ms>`, tokens/sec
- `warnings`, `providerMetadata`
- `response: { id, modelId, timestamp, headers, messages }`
- `request`

**Totals and aggregates** on the result:

- `result.totalUsage` is the sum over steps, and **`result.usage` returns the same total in v7** (getter `get usage() { return this.totalUsage }`).
- `result.toolCalls` / `toolResults` / `content` / `warnings` are flattened across steps.
- `text`, `finishReason`, `response` and `request` come from the **final** step (`result.finalStep`).

**Large payloads:** request/response bodies and request messages are **dropped by default**, via `include: { requestBody, requestMessages, responseBody }`, all `false` by default ("Large payloads (e.g., base64-encoded images) can cause memory issues"). Keep them off, because they would hold the photos.

**Live hooks:** `onStepEnd` (alias `onStepFinish`), `onToolExecutionStart`/`onToolExecutionEnd` (with `toolOutput` and `toolExecutionMs`), `onLanguageModelCallStart`/`End` and `onEnd`.

**Logging sketch** [inferred]:

```ts
for (const s of result.steps) {
  log.info({
    step: s.stepNumber, finish: s.finishReason, ms: s.performance.stepTimeMs,
    in: s.usage.inputTokens, cached: s.usage.inputTokenDetails.cacheReadTokens,
    out: s.usage.outputTokens, reasoning: s.usage.outputTokenDetails.reasoningTokens,
    calls: s.toolCalls.map(c => ({ tool: c.toolName, input: c.input })),
    results: s.content.filter(p => p.type === 'tool-result' || p.type === 'tool-error')
      .map(p => p.type === 'tool-error'
        ? { tool: p.toolName, error: String(p.error) }
        : { tool: p.toolName, output: p.output }),
  });
}
```

If a run throws (a timeout, or `NoOutputGeneratedError`), `result` does not exist. To log the partial trace, collect steps in `onStepEnd` into a local array instead.

## Open questions

- **Live behaviour of `gemini-3.8-flash` via the gateway with `tools` + `responseJsonSchema`** has not been observed. Google says Gemini 3 supports it and the SDK sends it, but the gateway's server-side provider version is not public. One live smoke test with a real key is needed before relying on it. Check two things:
  - (a) no 400 error;
  - (b) the model still calls `geocode` when a JSON schema is present, rather than answering JSON immediately.
- **Intermittent `NoOutputGeneratedError`** (vercel/ai#11466 comments, Gemini 3.1 Pro, ai 6.x). It is unknown whether this still happens on ai 7 / Gemini 3.8. The `toolChoice: 'none'`-on-last-step guard covers only the step-cap case, not a model that returns empty text with `stop`.
- **Gemini `mode: 'ANY'` (`toolChoice: 'required'`) combined with `responseJsonSchema`** was not checked in Google's docs. This matters only for the fallback pattern, which should drop `output` anyway.
- **Implicit cache hits through the AI Gateway**, including the Vertex route, and whether the gateway bills them at the cached rate: unverified.
- **The Q5 mock example was not executed.**
