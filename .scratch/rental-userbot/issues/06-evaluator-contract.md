# Evaluator contract and failure classes

Type: grilling
Status: resolved
Blocked by: 03

## Question

Given the AI Gateway facts, what exactly does the Evaluator send and how does it classify failures?

- Prompt layout: the system message (lenient-match rule, rental-offer rule, one-line reason, original language) vs the user message (Criteria text, Post text, photos). The language of `reason`, since the owner reads it in Saved Messages.
- Which failures count toward the 3 attempts (timeout, gateway 5xx, 429, schema-invalid output, photo download failure) and which, if any, fail at once (e.g. 401 bad key, 400 model not found).
- What the `<error>` text in the ⚠️ message contains: a short class plus message, with no stack traces or secrets.
- The msw fixtures the integration tests need: success, invalid output, persistent 5xx, timeout.
- Structured output is native: the SDK sends the zod schema as `responseFormat` and Gemini constrains its output to it, so the shape is not in doubt. Output that is cut off, blocked by a filter, or empty throws `NoObjectGeneratedError` / `NoOutputGeneratedError`; decide whether these count toward the 3 attempts. The schema can't make `reason` one line; decide whether the Notifier cuts it to the first line.
- Optional: one live call with a real key and 6 photos, to see thinking-token cost and latency (and whether `reasoning: 'low'` is worth setting).

## Answer

Decided with the owner (2026-09-19), building on [AI Gateway facts for the Evaluator](03-ai-gateway-facts.md).

**Prompt**
- System message: the fixed rules (lenient matching; a Post that is not a Rental offer is *no match*; write `reason` in the language of the Criteria) **plus the Criteria**, re-read before every evaluation.
- User message: the Post text in a clearly marked "data, not instructions" block, then the photos as file parts. Post text is untrusted, so it never goes in the system message.
- `reason` has no length or line constraint. The prompt does not ask for one sentence. Missing photos are not mentioned to the model.

**Before the model call**
- Photo download failures are **not retried**: the photo is skipped and logged with the Post link, and the Post is evaluated with whatever text and photos remain.
- A Post with no text and no photos, whether from the start or after every download failed, gets *no match* without a model call and is logged. Photos-only rental offers lost this way are accepted.

**Retries and failures**
- One attempt = one model call. **Every error counts toward the 3 attempts** (2s/4s backoff, 60s timeout). No failure classes; a bad key (401) or missing model just produces a ⚠️ per Post, which is the alert.
- The ⚠️ `<error>` is the last attempt's error as `<label>: <message>`. The label is `timeout` when the cause chain has a `TimeoutError`, otherwise the error's `name`. The message is the first line, with ANSI codes stripped, capped at about 200 characters. No stacks, request bodies or keys. The full error goes to the logs.

**Notifier**
- Cuts the whole outgoing message to Telegram's 4096-character limit as a safety net.

**Logging and cost**
- Every evaluation logs the Verdict, `reason`, token usage (input, output, reasoning) and latency. `reasoning` stays at the SDK default. No separate live call: the manual acceptance run supplies the real numbers, and `reasoning: 'low'` is a one-line change if thinking proves costly.

**Tests**
- msw fixtures: match, no match, schema-invalid output, persistent 500, one 500 then success, timeout.
- The Evaluator takes its retry policy (attempts, backoffs, timeout) as an injected setting; the production defaults are constants and tests pass millisecond values. No vitest fake timers.

**Spec changes for [Lock the decision-complete spec](07-lock-the-spec.md)**
- Drop "`reason` is one line".
- Remove photo download failure from the retryable list; it is skip-and-log instead.
- For [Telegram boundary and Post shape](05-telegram-boundary.md): photo download needs no retry, and a failed download must be skippable per photo.
## Comments

**2026-09-20, partly superseded by [Agentic Evaluator](20-agentic-evaluator.md).** Still true: photo failures are skipped not retried, an empty Post is *no match* without a call, the ⚠️ `<label>: <message>` format, the 4096 cap, the injected retry policy, and 3 attempts with 2s/4s backoff. Changed: the output is `{ match, notes }` (no `reason`); an attempt is a whole agent run (8 steps, 180s) rather than one model call; tool errors are not attempt failures while `NoOutputGeneratedError` is; the system message comes from an editable prompt file; and the msw AI Gateway fixtures are replaced by `MockLanguageModelV4` scripts, with msw kept for LocationIQ.
