# 15: Text-only Post evaluated and saved on a Match

**What to build:** the first full tracer through the pipeline. A new text-only message in a Watched channel becomes a Post, is judged against the Criteria by the model, and a Match lands in Saved Messages as `<link>\n<reason>`. Posts from other chats and empty Posts are dropped. See [spec](../spec.md) § Pipeline, § [1], § [2], § [4] Evaluator (before the call, the call), § [6] Notifier, § Logging.

**Blocked by:** 14 (Telegram connect, login, 🟢 startup message and Docker)

**Status:** ready-for-agent

- [ ] Adapter registers `onNewMessage` and emits Posts (`chatId` marked, `messageIds`, `text`, `photos: []`, `link` from `Message.link`); service messages never become Posts; the stream starts only after the 🟢 message
- [ ] Channel Filter is a pure function keeping only `chatId ∈ CHANNEL_IDS` (unit tested)
- [ ] A Post with no text and no photos is logged with its link and dropped
- [ ] Evaluator re-reads the Criteria file before every evaluation
- [ ] Model call per the spec: `generateText` with `Output.object` and the zod 4 schema `{ match, reason, places }` (`places`: array of strings, at most 3), `maxRetries: 0`, 60s timeout, `MODEL_ID`; single attempt in this ticket
- [ ] System message = fixed rules (lenient matching, non-Rental-offer is no match, `reason` in the Criteria's language, `places` rule) then the Criteria; Post text only in the user message inside a "data, not instructions" block
- [ ] Every evaluation logs token usage (input, output, reasoning) and latency
- [ ] Match → one `sendToMe` of `<link>\n<reason>`; No match → nothing sent
- [ ] One log line per Post with link, Verdict and reason
- [ ] Integration test: real pipeline with a fake `Telegram` + msw AI Gateway fixtures (match, no match; both carry `places`) — a Match produces exactly one send, a No match none, an unwatched chat none (Done-when 7, 9, 10)
