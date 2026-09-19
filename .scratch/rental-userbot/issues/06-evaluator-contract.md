# Evaluator contract and failure classes

Type: grilling
Status: open
Blocked by: 03

## Question

Given the AI Gateway facts, what exactly does the Evaluator send and how does it classify failures?

- Prompt layout: the system message (lenient-match rule, rental-offer rule, one-line reason, original language) vs the user message (Criteria text, Post text, photos). The language of `reason`, since the owner reads it in Saved Messages.
- Which failures count toward the 3 attempts (timeout, gateway 5xx, 429, schema-invalid output, photo download failure) and which, if any, fail at once (e.g. 401 bad key, 400 model not found).
- What the `<error>` text in the ⚠️ message contains: a short class plus message, with no stack traces or secrets.
- The msw fixtures the integration tests need: success, invalid output, persistent 5xx, timeout.
- Structured output is native: the SDK sends the zod schema as `responseFormat` and Gemini constrains its output to it, so the shape is not in doubt. Output that is cut off, blocked by a filter, or empty throws `NoObjectGeneratedError` / `NoOutputGeneratedError`; decide whether these count toward the 3 attempts. The schema can't make `reason` one line; decide whether the Notifier cuts it to the first line.
- Optional: one live call with a real key and 6 photos, to see thinking-token cost and latency (and whether `reasoning: 'low'` is worth setting).
