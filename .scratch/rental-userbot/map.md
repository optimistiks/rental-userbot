# Rental Listings Userbot v0

Labels: wayfinder:map

## Destination

A decision-complete v0 spec at [spec.md](spec.md), with every open technical question resolved and ready for `/to-tickets`. The build is not part of this map.

## Notes

- Domain: a Telegram userbot that evaluates rental Posts from Watched channels against Criteria. Vocabulary is in [CONTEXT.md](../../CONTEXT.md); use it.
- Skills: `domain-modeling` every session. `research` for mtcute and AI Gateway facts. `grilling` for decisions.
- Standing preferences: simplicity wins every tradeoff. mtcute is alpha, so pin exact versions and check its docs and source, never memory. Tests exist so agents can check their own work; final acceptance is manual.
- Baseline: [spec.md](spec.md) starts as the owner's original high-level spec and is updated only by [Lock the decision-complete spec](issues/07-lock-the-spec.md).

## Decisions so far

- [Charting decisions](issues/01-charting-decisions.md): destination = decision-complete spec. Notify then mark. One Post at a time. Criteria re-read every time. 3 attempts (2s/4s, 60s timeout). `resolve-channels` command plus startup membership warning. Latest Gemini Flash, no prompt tuning. vitest + msw + in-memory SQLite behind a fake Telegram interface. Latest Node, pnpm, tsx.
- [AI Gateway facts for the Evaluator](issues/03-ai-gateway-facts.md): `google/gemini-3.8-flash` via `ai@7.0.107` `generateText` + `Output.object` (zod 4), `maxRetries: 0`, ~$0.01 per 6-photo Post; msw-able (one POST per call), but fixtures are SDK-version-bound and timeouts/401s have quirky error shapes.
- [Runtime and Docker facts](issues/04-runtime-and-docker-facts.md): `node:26.9.0-trixie-slim`, better-sqlite3 13 prebuilt arm64 (no toolchain), tsx kept, pnpm 12 via npm with `allowBuilds: false` for better-sqlite3/esbuild; `compose run --rm` is interactive by default; stop the daemon before login.
- [mtcute facts for the Telegram Client](issues/02-mtcute-facts.md): pin `@mtcute/node`/`dispatcher` 0.32.1; albums only via `onMessageGroup` but can split past 250ms; `Message.link` builds links; photos via `getThumbnail('y')`; better-sqlite3 session storage; catchUp has gaps for unopened channels.
- [Telegram boundary and Post shape](issues/05-telegram-boundary.md): 4-method pipeline interface (`onPost`, `downloadPhoto`, `sendToMe`, `joinedChannelIds`), `resolve-channels` calls mtcute directly; Post carries marked `chatId`, `Message.link` and lazy photo handles (`y→x→largest`, photos only, ≤6); one identity key per Post (album = grouped ID), checked at dequeue, grouping interval 1000ms; dedupe in a separate `bot.sqlite` `processed_posts` table; empty Posts and service messages are dropped.

## Not yet specified

_Nothing left in the fog. Both earlier patches became tickets: [Docker and compose layout](issues/09-docker-layout.md), [Liveness signal](issues/10-liveness-signal.md)._

## Out of scope

- Everything in the spec's "Out of scope" list: history backfill, listing-level dedupe, per-criterion rating cards, a separate Bot API bot, handling edits and deletes, automatic channel joining.
- Hosting anywhere other than the owner's laptop.
- Multiple Criteria files or profiles.
- Prompt tuning against sample Posts (ruled out while charting).
