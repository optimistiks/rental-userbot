# Agentic Evaluator facts (AI SDK tools + Gemini)

Type: research
Status: resolved
Blocked by: —

## Question

For `ai@7.0.107` through the Vercel AI Gateway with `google/gemini-3.8-flash`, answer from current docs and source, not memory, citing versions:

1. Can one `generateText` call combine `tools` (with `execute`), multi-step `stopWhen`, and `output: Output.object(...)`? Is the structured output produced after the tool steps, and does Gemini 3.8 Flash on the gateway accept function calling together with a JSON response schema? If not, what is the recommended pattern, e.g. a final answer tool?
2. The tool definition API in ai@7 (`tool({ description, inputSchema, execute })` with zod 4), and how a tool `execute` error or a returned `{ error }` object reaches the model.
3. `stopWhen` / `stepCountIs` in ai@7, and the semantics of `timeout` and `abortSignal` over a multi-step run: total or per step. Is there a per-step timeout?
4. Do images in the first user message get resent on every step? What does the step history cost in tokens?
5. `ai/test` in ai@7: the mock language model class name and how to script a multi-step run (step 1 calls a tool, step 2 returns final structured output). Include a minimal example.
6. How to read the full step trace (tool calls, tool results, per-step usage) from the `generateText` result, for logging.

## Answer

Full findings, with sources and evidence tags: [research/agentic-evaluator.md](../research/agentic-evaluator.md). Sources are `ai@7.0.107`, `@ai-sdk/gateway@4.0.87` and `@ai-sdk/google@4.0.76`, all read in the published source, plus the Google docs.

1. **Tools + structured output: yes.** One `generateText` can take `tools`, `stopWhen` and `output: Output.object(...)`. The output is parsed only from the **last** step, after the tool steps.
   - Gemini 3 supports function calling together with a JSON schema; Google says it is "available only to Gemini 3 series models". The Google provider sends both in the same request.
   - `responseFormat` goes out on **every** step.
   - If the loop stops on a step that ends in `tool-calls`, `result.output` throws `NoOutputGeneratedError`. Intermittent cases of this error have also been reported on Gemini 3 (vercel/ai#11466).
   - **Pattern:** `tools` + `Output.object` + `isStepCount(N)`. In `prepareStep`, return `toolChoice: 'none'` on the last step. Treat `NoOutputGeneratedError` and `NoObjectGeneratedError` as bad output.
   - **Fallback:** a `submitVerdict` tool with no `execute` plus `toolChoice: 'required'`. Gemini has not been checked live through the gateway.
2. **Tool API:** `tool({ description, inputSchema: z.object(...), execute(input, { abortSignal, toolCallId, messages, context }) })`.
   - An error **thrown** in `execute` becomes a `tool-error`. The model sees `error-text` with the message, and the loop continues.
   - A **returned** `{ error }` is an ordinary JSON result.
   - Invalid input from the model is also returned to the model as a tool error. Nothing throws.
3. **`stopWhen` and timeouts:** `stepCountIs` was renamed to `isStepCount` (the old name is kept as an alias). The default is 1 step.
   - `timeout: number` and `abortSignal` cover the **whole run**, including tool execution.
   - A per-step timeout exists: `timeout: { stepMs }`. Its timer restarts every step and covers the model call and that step's tools. **When it fires, it aborts the whole run.**
   - `toolMs` or `tools.<name>Ms` time out a single tool execution, which becomes a tool error. `maxRetries` applies per model call.
4. **Images are resent on every step,** together with all earlier tool calls and results. A 3-step run with 6 photos costs about 26k input tokens instead of about 8.5k. Gemini implicit caching (on by default, prefix ≥ 4,096 tokens) should discount the repeats, but that is unverified through the gateway.
5. **Testing:** `MockLanguageModelV4` from `ai/test`. Pass `doGenerate: [toolCallResult, finalJsonResult]`, with the tool call's `input` as a JSON string. Calls are recorded in `model.doGenerateCalls`. A full example is in the research file.
6. **Step trace:** `result.steps[]` gives per step `toolCalls`, `toolResults` (successes only), `content` (which includes `tool-error`), `usage` (including cache and reasoning tokens), `performance.stepTimeMs` and `toolExecutionMs`, and `finishReason`.
   - In v7, `result.usage` equals `totalUsage`.
   - Use `onStepEnd` to keep a partial trace when the run throws.
