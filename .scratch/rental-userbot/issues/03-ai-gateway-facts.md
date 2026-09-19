# AI Gateway facts for the Evaluator

Type: research
Status: resolved
Blocked by: —

## Question

How should the Evaluator call a vision model through the Vercel AI Gateway, based on current docs and source? Cite versions.

1. **Model ID.** The exact AI Gateway model ID of the latest Gemini Flash model that accepts images, and its per-token and per-image pricing on the gateway.
2. **Client.** The recommended way to call the gateway from Node: the `ai` SDK (which version, and which provider or plain string model ID) vs the OpenAI-compatible HTTP endpoint. How `AI_GATEWAY_API_KEY` is picked up.
3. **Structured output with images.** How to send text plus several image `Buffer`s in one request and get back a schema-validated object (`{ match: boolean, reason: string }`). This could be `generateObject`, `generateText` with an output schema, or whatever is current. Include which schema library is expected (zod version).
4. **Errors and retries.** Which error classes or shapes are thrown for timeouts, gateway 4xx/5xx and unparseable or schema-invalid output. How to set a per-attempt timeout (abort signal). How to turn off the SDK's own retries (`maxRetries`) so our 3-attempt policy is the only one.
5. **Testability.** Whether the SDK's gateway calls go through global `fetch` (or accept a custom `fetch`) so msw can intercept them in Node. Also the gateway's request URL and the response shape that a msw handler must return for a successful structured-output call.

Write findings to `.scratch/rental-userbot/research/ai-gateway.md`.

## Answer

Findings are in [research/ai-gateway.md](../research/ai-gateway.md). The error behaviour was checked against the real SDK with msw.

- **Model:** `google/gemini-3.8-flash` (released 2026-09-02, accepts images). $0.75 per million input tokens and $3.75 per million output tokens, with thinking tokens billed as output. Each image counts as about 1,120 input tokens, so roughly $0.01 per 6-photo Post. Google's list price doubles on 2027-01-01, and the gateway is likely to follow.
- **Client:** `ai@7.0.107` (pin exactly). Pass the model as a plain string ID; `AI_GATEWAY_API_KEY` is read from the environment. The package is ESM-only and needs Node 22 or later.
- **Structured output:** `generateText` with `output: Output.object({ schema })` and zod 4. `generateObject` is deprecated. Images are sent as `{ type: 'file', mediaType: 'image', data: Buffer }`.
- **Retries:** `maxRetries: 0` means our policy is the only one. Set the per-attempt timeout with `timeout` or `abortSignal`. Invalid output throws `NoObjectGeneratedError`. Gateway errors carry `statusCode` and `isRetryable`.
- **Gotchas:**
  - A timeout comes back as `GatewayResponseError` with status 500, so check `cause.name === 'TimeoutError'` first.
  - A 401 is a plain `Error` named `GatewayAuthenticationError`, which is not a `GatewayError`.
  - Tests need `AI_GATEWAY_API_KEY` set to any value.
- **msw:** the SDK uses global `fetch` and makes exactly one `POST https://ai-gateway.vercel.sh/v4/ai/language-model` per call. The response body is the SDK's internal, undocumented format, so fixtures are tied to the pinned version. A tested handler is in the findings file.
- **Open:** thinking-token use and latency with 6 images; this needs one live call with a real key. Schema reliability isn't open: the SDK sends the schema as native `responseFormat`, so the remaining failures are output that is cut off, blocked by a filter, or empty, and all of them throw.
