# Research: Vercel AI Gateway + Gemini Flash for the rental userbot

Researched 2026-09-19. Sources are primary: Vercel docs, the public AI Gateway model API, Google Gemini API docs, and the npm source of `ai@7.0.107`, `@ai-sdk/gateway@4.0.87`, `@ai-sdk/provider-utils@5.0.45` and `@ai-sdk/provider@4.0.17` (unpacked with `npm pack`). Package paths below such as `gateway@4.0.87: src/...` point into those tarballs. The behaviour claims marked **(spike)** were confirmed by running a script against msw 2.15.0 + zod 4.6.5 on Node 26.

## Summary / recommendations

- **Model:** `google/gemini-3.8-flash`, released 2026-09-02. It is the newest non-Lite Gemini Flash on the gateway and accepts image input. It costs **$0.75 per 1M input tokens and $3.75 per 1M output tokens**, and thinking tokens count as output. Images have no separate per-image fee: each image is billed as input tokens, about 1,120 tokens at the default resolution. **Google's list price doubles on 2027-01-01**, and the gateway passes list price through.
- **Client:** use the **AI SDK: `ai@7` (7.0.107)**, which Vercel recommends for new projects. Pass the plain string `'google/gemini-3.8-flash'` as the model. The SDK then uses the default gateway provider, which reads `AI_GATEWAY_API_KEY` from the environment. The package is **ESM-only and needs Node >= 22**.
- **Structured output:** `generateObject` is **deprecated** in v7. Use `generateText({ output: Output.object({ schema }) })` with a **zod** schema (peer dependency `zod ^3.25.76 || ^4.1.8`, current release 4.6.5). Send images as `{ type: 'file', mediaType: 'image', data: Buffer }` parts.
- **Retries and timeouts:** pass `maxRetries: 0`. The SDK then makes exactly one HTTP attempt and throws the raw error without wrapping it. Pass `timeout: ms` or `abortSignal` to bound each attempt. **Catch:** a client-side timeout does *not* come back as `GatewayTimeoutError`. It comes back as `GatewayResponseError` (statusCode 500) with `cause.name === 'TimeoutError'`, so classify errors by walking `cause`.
- **Testability:** works with msw. The SDK calls `globalThis.fetch` at request time (a custom `fetch` is also accepted). Each call makes **one POST to `https://ai-gateway.vercel.sh/v4/ai/language-model`** and nothing else (no metadata fetch). **The response body is not an OpenAI-style body.** It is the AI SDK's internal `LanguageModelV4GenerateResult` JSON. A working handler is shown in Q5.

## Q1. Model ID and pricing

**Latest Gemini Flash with image input: `google/gemini-3.8-flash`**

- The public gateway catalogue `GET https://ai-gateway.vercel.sh/v1/models` (fetched 2026-09-19) lists these Gemini Flash models with their release dates:
  - `gemini-3.8-flash`: 2026-09-02
  - `gemini-3.7-flash`: 2026-08-13
  - `gemini-3.6-flash` and `gemini-3.5-flash-lite`: 2026-07
  - `gemini-3.5-flash`
  - `gemini-3.1-flash-lite`
  - `gemini-3-flash`
  - `*-image` variants, which are for image generation
- The `google/gemini-3.8-flash` record has:
  - `modalities.input: ["text","image","pdf","video"]`
  - tags `vision`, `file-input`, `reasoning`
  - `supported_specifications: ["v2","v3","v4"]`
  - `context_window: 1000000`, `max_tokens: 65536`
  - `reasoning_options: effort low|medium|high`
  - `regions: eu, us`
- Vercel's model page (https://vercel.com/ai-gateway/models/gemini-3.8-flash) confirms the ID `google/gemini-3.8-flash`, providers Google and Vertex, $0.75 per 1M input and $3.75 per 1M output.
- Google's pricing page (https://ai.google.dev/gemini-api/docs/pricing) lists `gemini-3.8-flash` first as "Our most intelligent Flash model". The ID has no `-preview` suffix.

**Pricing on the gateway** (from `/v1/models`, field `pricing`, USD per token)

| | input | output | cached input read |
|---|---|---|---|
| standard | 0.00000075 ($0.75/M) | 0.00000375 ($3.75/M) | 0.000000075 |
| flex tier | $0.375/M | $1.875/M | |
| priority tier | $1.35/M | $6.75/M | |
| regional (eu/us pinned) | $0.825/M | $4.125/M | |

- `GET https://ai-gateway.vercel.sh/v1/models/google/gemini-3.8-flash/endpoints` shows both the `google` and `vertex` endpoints at the same token prices, with **`"image": "0"`**. So there is no per-image fee, and images are billed as input tokens.
- Vercel charges "no markup and no platform fee on tokens. You pay the provider's list price" (https://vercel.com/docs/ai-gateway/pricing). The free tier covers "a subset of models" and has lower rate limits.
- Google's page lists the paid-tier price as "$0.75 through December 31, 2026. $1.50 starting January 1, 2027". Output goes from $3.75 to $7.50 on the same date, and the output price includes thinking tokens (https://ai.google.dev/gemini-api/docs/pricing).

**How images are counted.** For Gemini 3 models, one image costs 1,120 tokens at the default (`unspecified`) resolution. The other levels are:

| resolution | tokens per image |
|---|---|
| low | 280 |
| medium | 560 |
| high | 1,120 |
| ultra_high | 2,240 |

Source: https://ai.google.dev/gemini-api/docs/media-resolution, "Token counts" table.

**Rough cost per post** (my arithmetic, not a quoted figure):

- Input: 6 images × 1,120 = 6,720 tokens, plus about 1–2k tokens of text and criteria. That is about 8.5k tokens × $0.75/M ≈ **$0.0064**.
- Output: about 0.5–2k tokens including thinking, × $3.75/M ≈ **$0.002–0.0075**.
- Total: **about $0.01 per post** at 2026 prices, and about double from 2027-01-01.
- Thinking can be capped with the top-level `reasoning: 'low'` option (ai@7.0.107: `docs/03-ai-sdk-core/26-reasoning.mdx`). The gateway forwards the whole call-options object: gateway@4.0.87 `src/gateway-language-model.ts` `getArgs` strips only `abortSignal`.

## Q2. Client

- Vercel's recommendation: "New project? Use AI SDK" (https://vercel.com/docs/ai-gateway/sdks-and-apis). That page also lists these requirements for AI SDK 7: "Node.js 22 or later, ESM", install `ai@7`.
- **Versions** (`npm view`, 2026-09-19):
  - `ai` latest: `7.0.107`. The older lines stay available under the dist-tags `ai-v6` (6.0.286) and `ai-v5`.
  - `ai` depends on the pinned `@ai-sdk/gateway@4.0.87`, so there is no need to install the gateway package separately. Import it directly only if you want `createGateway` or the error classes.
  - `package.json` of both packages: `"type": "module"`, `"engines": {"node": ">=22"}`, and the `exports` map has only `import`/`default`. **They are ESM-only, with no CJS build.**
- **A plain string or the provider?** Both reach the same code.
  - ai@7.0.107 `src/model/resolve-model.ts`: when the model is a string, it calls `getGlobalProvider().languageModel(model)`, and the global provider defaults to `gateway` from `@ai-sdk/gateway`.
  - `gateway` is `createGateway()` with default options (gateway@4.0.87 `src/gateway-provider.ts`).
  - Use `createGateway({ apiKey, baseURL, fetch })` only when you need explicit injection, for example a key loaded from config rather than from the environment, or a custom `fetch`.
- **How the key is picked up:**
  - In gateway@4.0.87 `src/gateway-provider.ts`, `getGatewayAuthToken` runs `loadOptionalSetting({ settingValue: options.apiKey, environmentVariableName: 'AI_GATEWAY_API_KEY' })` **on every request** (`getHeaders` is async and resolved per call).
  - If no key is found, it falls back to the Vercel OIDC token (`getVercelOidcToken`). That token does not exist outside Vercel, so the call fails with `GatewayAuthenticationError`.
  - The key is sent as `Authorization: Bearer <key>` together with `ai-gateway-protocol-version: 0.0.1` and `ai-gateway-auth-method: api-key` **(spike)**.
  - Vercel's docs agree: "When you specify a model id as a plain string, the AI SDK automatically uses the Vercel AI Gateway provider and reads the API key from the `AI_GATEWAY_API_KEY` environment variable" (https://vercel.com/docs/ai-gateway/authentication-and-byok).
- **OpenAI-compatible endpoint:** `https://ai-gateway.vercel.sh/v1` with the `openai` SDK, sending structured output as `response_format`. It works, but you lose zod validation and would handle retries, parsing and image encoding yourself. Not recommended here.

## Q3. Structured output with images

- In ai@7.0.107 `dist/index.d.ts`, `generateObject` carries the tag `@deprecated Use generateText with an output setting instead.`
- `docs/03-ai-sdk-core/10-generating-structured-data.mdx`: "Use `generateText` with `Output.object()` to generate structured data… The schema is also used to validate the generated data".
- Image parts: v7 deprecated `{ type: 'image', image }`. Use `{ type: 'file', mediaType: 'image', data }` instead (`docs/08-migration-guides/23-migration-guide-7-0.mdx`). `data` can be a `Buffer`, `Uint8Array`, base64 string or URL (`docs/02-foundations/03-prompts.mdx`, "Image Parts").
- When `data` holds bytes, the SDK detects the real image type from the bytes and **overrides** the `mediaType` you pass (ai@7.0.107 `src/prompt/convert-to-language-model-prompt.ts` ~L583–593). In the spike, `'image/jpeg'` was sent as `image/png` because the test bytes were PNG. Passing `mediaType: 'image'` is therefore enough for Telegram JPEGs.
- The gateway provider base64-encodes `Uint8Array`/`Buffer` data before posting (gateway@4.0.87 `src/gateway-language-model.ts` `maybeBase64EncodeFileData`). The gateway declares `supportedUrls: {'*/*': [/.*/]}`, so the SDK never downloads anything itself.

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod'; // zod 4.x; ai peerDep: ^3.25.76 || ^4.1.8

export const Verdict = z.object({ match: z.boolean(), reason: z.string() });

const { output } = await generateText({
  model: 'google/gemini-3.8-flash',
  maxRetries: 0,          // our own 3-attempt policy (Q4)
  timeout: 60_000,        // per attempt (Q4)
  output: Output.object({ schema: Verdict }),
  system: criteriaText,   // or `instructions`
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: postText },
      ...photos.map((data: Buffer) => ({ type: 'file' as const, mediaType: 'image', data })),
    ],
  }],
});
// output: { match: boolean; reason: string }
```

- The spike confirmed that zod is turned into a JSON Schema and sent as `responseFormat: { type: 'json', schema: {…, required: ['match','reason'], additionalProperties: false} }`.
- An `output.description` in the prompt can help the model write a good `reason`. This is optional.

## Q4. Errors, timeouts, retries

**Disabling SDK retries**

- ai@7.0.107 `src/util/prepare-retries.ts`: `maxRetries` defaults to 2.
- provider-utils@5.0.45 `src/retry-with-exponential-backoff.ts`: "if (maxRetries === 0) throw error; // don't wrap the error when retries are disabled".
- With `maxRetries: 0` you get exactly one HTTP request and the original error **(spike)**.
- With `maxRetries >= 1`, errors are wrapped in `AI_RetryError`, and the SDK waits with exponential backoff starting at 2s. In the spike, `maxRetries: 1` made 2 requests over about 2s.

**Per-attempt timeout**

- `timeout: number` or `abortSignal: AbortSignal.timeout(ms)` (`docs/03-ai-sdk-core/25-settings.mdx`). `timeout: { stepMs }` also exists.
- With `maxRetries: 0` and a single-step call, `timeout` is effectively a per-attempt timeout. Create a new signal for each of our attempts.

**What gets thrown with `maxRetries: 0`** (spike, `generateText` + `Output.object`)

| situation | thrown value | useful fields |
|---|---|---|
| gateway 500 `{error:{type:'internal_server_error'}}` | `GatewayInternalServerError` | `statusCode 500`, `isRetryable true`, `cause: APICallError` |
| gateway 429 `rate_limit_exceeded` | `GatewayRateLimitError` | `429`, `isRetryable true` |
| gateway 400 `invalid_request_error` | `GatewayInvalidRequestError` | `400`, `isRetryable false` |
| gateway 404 `model_not_found` | `GatewayModelNotFoundError` | from source, `src/errors/create-gateway-error.ts` |
| 502 with a non-JSON body | `GatewayResponseError` | `statusCode 502`, `isRetryable true` |
| 401 `authentication_error` | **plain `Error` with `name === 'GatewayAuthenticationError'`** | `GatewayError.isInstance` is **false** |
| client timeout (`timeout` or `abortSignal` TimeoutError) | **`GatewayResponseError`**, `statusCode 500`, `isRetryable true` | `cause` is `DOMException` with `name 'TimeoutError'` |
| model text not valid JSON | `NoObjectGeneratedError` (`AI_NoObjectGeneratedError`) | `cause: AI_JSONParseError`, `.text` holds the raw output |
| JSON that fails the schema | `NoObjectGeneratedError` | `cause: AI_TypeValidationError`, `.text` |

Where these come from in the source:

- The gateway error hierarchy is in gateway@4.0.87 `src/errors/`. The base class `GatewayError` has `statusCode`, `isRetryable` (default: 408/409/429/>=500) and `generationId`. Its `isInstance` checks a `Symbol.for` marker. `GatewayError` is exported from `@ai-sdk/gateway` and is **not** re-exported from `ai`.
- The mapping from `error.type` to a class is in `create-gateway-error.ts`. The expected error body is `{ error: { message, type?, param?, code? }, generationId? }`.
- **Why a timeout does not become `GatewayTimeoutError`:**
  - `asGatewayError` only recognises undici timeout *codes* (`UND_ERR_HEADERS_TIMEOUT`, etc.).
  - An abort `DOMException('TimeoutError')` has no code, so it goes to the fallback branch. That branch builds `{response:{}, statusCode:500}`, which fails the error-body schema and produces `GatewayResponseError` (`src/errors/as-gateway-error.ts`).
- **Why the 401 is a plain `Error`:** ai@7.0.107 `src/prompt/wrap-gateway-error.ts` replaces `GatewayAuthenticationError` with a plain `Error` that has an ANSI-coloured message. When `NODE_ENV === 'production'` it uses an `AISDKError` named `'GatewayError'` instead.
- The structured-output failures are documented in `docs/03-ai-sdk-core/10-generating-structured-data.mdx` §Error Handling. `NoOutputGeneratedError` is thrown when the step finishes without `stop`, for example because of a content filter.

**Suggested classifier** (sketch):

```ts
import { NoObjectGeneratedError } from 'ai';
import { GatewayError } from '@ai-sdk/gateway';

function hasCause(e: unknown, pred: (x: any) => boolean): boolean {
  for (let c: any = e, i = 0; c && i < 10; c = c.cause, i++) if (pred(c)) return true;
  return false;
}
export function classify(e: unknown) {
  if (hasCause(e, c => c?.name === 'TimeoutError' || c?.name === 'AbortError')) return 'timeout';
  if (NoObjectGeneratedError.isInstance(e)) return 'bad-output';
  if ((e as any)?.name === 'GatewayAuthenticationError') return 'auth';     // plain Error in dev
  if (GatewayError.isInstance(e)) return e.isRetryable ? 'transient' : 'permanent';
  return 'unknown';
}
```

Check for a timeout before checking `GatewayError`, because a timeout arrives as a `GatewayResponseError`.

## Q5. Testability with msw

- **The SDK uses the global fetch, looked up at call time.** provider-utils@5.0.45 `src/post-to-api.ts` has `const getOriginalFetch = () => globalThis.fetch;` and `fetch = getOriginalFetch()` as a parameter default, so it is resolved per request. msw's `setupServer` patches the global fetch, which is enough.
- `createGateway({ fetch })` also accepts a custom fetch ("for e.g. testing", `src/gateway-provider.ts`).
- **Request:** `POST https://ai-gateway.vercel.sh/v4/ai/language-model` (`baseURL` default `https://ai-gateway.vercel.sh/v4/ai` + `/language-model`, `src/gateway-language-model.ts#getUrl`).
  - The model is chosen by the **`ai-language-model-id` header**, not by a field in the body.
  - Other headers: `ai-language-model-streaming: false` and `ai-language-model-specification-version: 4`.
  - Body: `{ prompt: [...], responseFormat: { type:'json', schema }, toolChoice, headers }`, with images as `{type:'file', mediaType, data:{type:'data', data:'<base64>'}}` **(spike)**.
- **No extra requests:**
  - Exactly one request per `generateText` call in every spike case (msw `request:start` log).
  - `/config`, the model metadata, is fetched only by `gateway.getAvailableModels()`, and nothing in `ai` calls it.
  - `/v1/credits` is fetched only by `getCredits()`.
- **Success body** = the JSON of `LanguageModelV4GenerateResult` (`@ai-sdk/provider@4.0.17 src/language-model/v4/language-model-v4-generate-result.ts`), which `doGenerate` spreads out almost unchanged.
  - Required fields: `content`, `finishReason: { unified, raw }` and `usage`. `usage` may have empty `inputTokens`/`outputTokens` objects **(spike "minimal")**.
  - `warnings` is optional.
- **Error body:** `{ error: { message, type } }` plus the HTTP status (the mapping is in Q4).

Minimal working example (a trimmed version of the spike that ran; vitest syntax):

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';

const GATEWAY = 'https://ai-gateway.vercel.sh/v4/ai/language-model';

export const verdictResponse = (v: { match: boolean; reason: string }) =>
  HttpResponse.json({
    content: [{ type: 'text', text: JSON.stringify(v) }],
    finishReason: { unified: 'stop', raw: 'STOP' },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 20, text: 20, reasoning: 0 },
    },
    warnings: [],
  });

const server = setupServer(
  http.post(GATEWAY, () => verdictResponse({ match: true, reason: '2 rooms, 40k' })),
);
beforeAll(() => { process.env.AI_GATEWAY_API_KEY = 'test'; server.listen({ onUnhandledRequest: 'error' }); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('5xx', async () => {
  server.use(http.post(GATEWAY, () =>
    HttpResponse.json({ error: { message: 'boom', type: 'internal_server_error' } }, { status: 500 })));
  // expect GatewayInternalServerError
});
it('schema-invalid', async () => {
  server.use(http.post(GATEWAY, () => HttpResponse.json({
    content: [{ type: 'text', text: '{"match":"yes"}' }],
    finishReason: { unified: 'stop', raw: 'STOP' },
    usage: { inputTokens: {}, outputTokens: {} },
  })));
  // expect NoObjectGeneratedError
});
it('timeout', async () => {
  server.use(http.post(GATEWAY, async () => { await delay(2000); return HttpResponse.json({}); }));
  // call with timeout: 300 → GatewayResponseError, cause.name === 'TimeoutError'
});
```

Notes:

- The handler can check `request.headers.get('ai-language-model-id') === 'google/gemini-3.8-flash'`, and can read `(await request.json()).prompt` to check that the images were sent.
- `AI_GATEWAY_API_KEY` must be set (any value) or passed as `createGateway({ apiKey })`. Otherwise the provider tries the OIDC fallback and fails before any fetch happens.
- The msw docs describe the Node integration (`setupServer` from `msw/node`) at https://mswjs.io/docs/integrations/node. msw latest is 2.15.0.
- An alternative that needs no HTTP at all: `MockLanguageModelV4` from `ai/test` (`docs/03-ai-sdk-core/55-testing.mdx`).

## Open uncertainties

- **The gateway's internal wire protocol (`/v4/ai/language-model`, `ai-gateway-protocol-version: 0.0.1`) is not publicly documented.** It comes from the SDK source and could change with a minor `@ai-sdk/gateway` bump, since `ai` pins an exact version. Pin `ai` exactly and treat the msw fixtures as tied to that version. An SDK upgrade may need fixture updates.
- **Price change on 2027-01-01:** Google's page doubles the price then. The gateway docs promise list price, so the gateway price will presumably follow, but that is not stated for this model.
- **Free tier:** I could not tell whether `gemini-3.8-flash` is in the gateway free tier. The `/v1/models` payload has no free-tier field, and the model list filter `?freeTier=true` is a client-side page.
- **Image tokens through the gateway:** the 1,120 tokens per image comes from Google's API docs. The gateway may route to Vertex. I assumed the same tokenisation there (same model family) but did not verify it. Setting `media_resolution` (per-part `providerOptions.google`) through the gateway was not verified either.
- **Timeout classification quirk:** timeouts become `GatewayResponseError` with `isRetryable: true` and a synthetic `statusCode: 500`. This was observed with the fixed source versions listed above and looks unintended, so it may change. Always check `cause` first.
- **Real-model behaviour** (whether Gemini 3.8 Flash reliably follows `responseFormat` JSON schema, how many thinking tokens it uses with and without `reasoning: 'low'`, latency with 6 images) was **not measured**. That needs one live call with a real key.
