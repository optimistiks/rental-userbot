# 18: Failure paths: retries, ⚠️ couldn't evaluate, failed sends

**What to build:** when the model keeps failing, the owner gets one `⚠️ couldn't evaluate` entry after 3 attempts; when a send fails at runtime, the bot logs it and keeps running. See [spec](../spec.md) § [4] Evaluator (retries), § [6] Notifier.

**Blocked by:** 15 (Text-only Post evaluated and saved on a Match)

**Status:** ready-for-agent

- [ ] Retry policy is an injected setting (attempts, backoffs, timeout); production constants are 3 attempts, 2s then 4s backoff, 60s per attempt; tests pass millisecond values, no fake timers
- [ ] Every error counts as a failed attempt; no failure classes
- [ ] Error formatter `<label>: <message>` (unit tested): label `timeout` if the cause chain holds a `TimeoutError`, else the error's `name`; message = first line, ANSI removed, cut to ~200 chars; no stacks, bodies or keys. The full error goes to the logs
- [ ] A Criteria read failure at evaluation time is an evaluation failure with no model call and no retry
- [ ] Evaluation failure sends `<link>\n⚠️ couldn't evaluate: <label>: <message>`
- [ ] Every outgoing message is cut to 4096 characters (unit tested)
- [ ] A runtime send failure is logged with the Post link, the Post is still marked processed, and the pipeline continues with the next Post
- [ ] msw AI Gateway fixtures: schema-invalid output, persistent 500, one 500 then success, timeout
- [ ] Integration tests: persistent failure → exactly 3 calls and one ⚠️ entry (Done-when 12); 500-then-success → a normal Match; a fake `Telegram` whose `sendToMe` throws → error logged, next Post still processed (Done-when 14)
