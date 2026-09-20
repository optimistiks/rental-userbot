# 18: Failure paths: retries, ⚠️ couldn't evaluate, failed sends

**What to build:** when the agent run keeps failing, the owner gets one `⚠️ couldn't evaluate` entry after 3 attempts; when a send fails at runtime, the bot logs it and keeps running. See [spec](../spec.md) § [4] Evaluator (retries), § [5] Notifier.

**Blocked by:** 15 (Text-only Post evaluated and saved on a Match)

**Status:** resolved

- [x] Retry policy is an injected setting (attempts, backoffs, run timeout, step cap); production constants are 3 attempts, 2s then 4s backoff, 180s and 8 steps per run; tests pass millisecond values, no fake timers
- [x] Every error counts as a failed attempt (one attempt = one whole agent run), including `NoOutputGeneratedError`/`NoObjectGeneratedError`; no failure classes. Tool errors are not attempt failures
- [x] Error formatter `<label>: <message>` (unit tested): label `timeout` if the cause chain holds a `TimeoutError`, else the error's `name`; message = first line, ANSI removed, cut to ~200 chars; no stacks, bodies or keys. The full error goes to the logs
- [x] A prompt or Criteria read failure at run time is an evaluation failure with no agent run and no retry
- [x] Evaluation failure sends `<link>\n⚠️ couldn't evaluate: <label>: <message>`
- [x] Every outgoing message is cut to 4096 characters (unit tested)
- [x] A runtime send failure is logged with the Post link, the Post is still marked processed, and the pipeline continues with the next Post
- [x] Mock-model scripts: a run that ends without output, a persistent failure, one failure then success, a timeout
- [x] Integration tests: persistent failure → exactly 3 runs and one ⚠️ entry (Done-when 12); failure-then-success → a normal Match; a fake `Telegram` whose `sendToMe` throws → error logged, next Post still processed (Done-when 14)

## Comments

- 2026-09-20: Implemented retry/failure handling, capped notifications, and send-failure liveness. Added MockLanguageModelV4 coverage for empty output, invalid structured output, persistent/transient failures, and timeout; the full pipeline covers warning delivery, recovered Matches, and continued processing after a failed send. `pnpm test` (58 tests), `pnpm typecheck`, and `git diff --check` pass. Tool-error behavior remains owned by the SDK and will be exercised at the tool seam in ticket 19.
