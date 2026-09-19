# 15: Text-only Post evaluated by the agent and saved on a Match

**What to build:** the first full tracer through the pipeline. A new text-only message in a Watched channel becomes a Post, is judged by the agent against the prompt and Criteria, and a Match lands in Saved Messages as `<link>\n<notes>`. Posts from other chats and empty Posts are dropped. See [spec](../spec.md) § Pipeline, § [1], § [2], § [4] Evaluator (before the run, the run, the prompt file), § [5] Notifier, § Logging and Sentry. The tools arrive in ticket 19.

**Blocked by:** 14 (Telegram connect, login, 🟢 startup message and Docker)

**Status:** resolved

- [x] Adapter registers `onNewMessage` and emits Posts (`chatId` marked, `messageIds`, `text`, `photos: []`, `link` from `Message.link`); service messages never become Posts; the stream starts only after the 🟢 message
- [x] Channel Filter is a pure function keeping only `chatId ∈ CHANNEL_IDS` (unit tested)
- [x] A Post with no text and no photos is logged with its link and dropped
- [x] New settings `PROMPT_PATH` (default `data/prompt.md`) and the startup check for the prompt file, as § Configuration and § Startup step 2 now have them; `data.example/prompt.md` holds the starting prompt
- [x] Evaluator re-reads the prompt file and the Criteria file before every run, and assembles the system message as prompt + Criteria (unit tested)
- [x] Agent run per the spec: `generateText` with `Output.object` and the zod 4 schema `{ match, notes }`, `stopWhen: isStepCount(8)`, `prepareStep` forcing `toolChoice: 'none'` on the last allowed step, reasoning summaries on, `maxRetries: 0`, 180s timeout, `MODEL_ID`; the model is injected so tests can pass a mock; single attempt and no tools in this ticket
- [x] The prompt file carries the working order and the decision rules; tools are never described in it. Post text goes only in the user message, inside a "data, not instructions" block
- [x] Every run logs its steps, token usage (input, output, reasoning) and latency, read from `result.steps` / `onStepEnd`
- [x] Match → one `sendToMe` of `<link>\n<notes>`; No match → nothing sent
- [x] One log line per Post with link, Verdict and notes
- [x] Integration test: real pipeline with a fake `Telegram` + `MockLanguageModelV4` from `ai/test` (a Match run and a No match run) — a Match produces exactly one send, a No match none, an unwatched chat none; the mock's recorded request shows the prompt, Criteria and Post text in the right places (Done-when 7, 9, 10)

## Comments

- 2026-09-20: Implemented and reviewed. Automated tests and typechecking pass.
