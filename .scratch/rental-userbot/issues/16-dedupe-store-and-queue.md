# 16: Dedupe Store and the one-at-a-time queue

**What to build:** each Post is evaluated exactly once, even across restarts, and Posts are evaluated one at a time. See [spec](../spec.md) § Pipeline, § [3] Dedupe Store.

**Blocked by:** 15 (Text-only Post evaluated and saved on a Match)

**Status:** ready-for-agent

- [ ] Post key is one pure function: `<chatId>:<messageId>` for a single message, `<chatId>:album:<albumId>` for an album (unit tested)
- [ ] Dedupe Store over `processed_posts`: check and mark (unit tested with `:memory:`)
- [ ] An in-process queue evaluates one Post at a time
- [ ] The key is checked before queueing and again at dequeue; a second copy queued before the first was marked is dropped at dequeue
- [ ] A Post is marked processed after the Notifier step, whatever the Verdict and whether or not the send succeeded
- [ ] Integration test: the same Post delivered twice is evaluated once
- [ ] Integration test (restart): two pipeline instances sharing one DB handle — the second never re-evaluates a Processed Post (Done-when 13)
