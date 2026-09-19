# Charting decisions

Type: grilling
Status: resolved
Blocked by: —

## Question

What is the destination of this effort, and what standing product and engineering decisions can be locked before any research?

## Answer

Decided with the owner while charting the map (2026-09-19).

**Destination and scope**
- The destination is a decision-complete v0 spec at `.scratch/rental-userbot/spec.md`, ready for `/to-tickets`. The build happens after the map, not inside it.
- The spec's "Out of scope" list is final. Also out of scope: hosting anywhere other than the laptop, and multiple Criteria files or profiles.
- The vocabulary (Post, Watched channel, Listing, Rental offer, Criteria, Verdict, Match) is recorded in `CONTEXT.md`. A Post that is not a Rental offer gets the Verdict *no match*, not a separate one.

**Pipeline behaviour**
- Order of steps: notify first, then mark processed (as in the spec). A crash between the two can cause a rare duplicate Saved Messages entry. That is accepted; losing a match is not.
- Posts are evaluated **one at a time** through an in-process queue. No parallel evaluation.
- The Criteria file is **re-read before every evaluation**. Edits apply without a restart.
- Retries: **3 attempts in total**, with 2s then 4s backoff and a 60s timeout per attempt. The ⚠️ message is sent after the third failure. These values are constants in code.
- At startup, compare `CHANNEL_IDS` against the account's dialogs and **log a warning** for each ID that isn't joined. The bot never joins and never messages the owner about it.

**Channel IDs**
- `CHANNEL_IDS` stays a list of numeric IDs.
- Add a one-shot, read-only command `resolve-channels <link|@name|title>...` that prints `id  title  @username` only for the inputs given. Accepted inputs: `@username`, `t.me/<name>`, `t.me/c/<id>/…`, or a title of an already-joined channel. Invite links (`t.me/+…`) are not supported.

**Evaluator**
- Model: the latest Gemini Flash on the Vercel AI Gateway. The exact ID is a research fact.
- No prompt-tuning or sample-Post prototype for v0. The prompt is written once from the spec rules.

**Testing**
- Automated tests are there so agents can check their own work. Tools: vitest, plus msw for the AI Gateway HTTP.
- Telegram sits behind a small in-house interface (Posts in, photo download, send text to `me`). It is faked in tests.
- Integration tests run the real pipeline (filter, dedupe, assembler, evaluator, notifier) against fake Telegram, msw and **in-memory SQLite** (`:memory:`). The restart case reuses one DB handle across two pipeline instances.
- Unit tests cover the pure pieces: link format, filter, dedupe, message format, retry.
- Final acceptance is manual, in a private test channel the owner creates. It covers login, session reuse and real links.

**Tooling**
- Latest Node (26 or whatever is current; research confirms), pnpm, `tsx`, no build step, vitest, `console` logs to Docker logs. mtcute versions are pinned exactly.
