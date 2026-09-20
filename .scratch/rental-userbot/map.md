# Rental Listings Userbot v0

Labels: wayfinder:map

**Status: done.** Destination reached: [spec.md](spec.md) is locked, and the build tickets it was sliced into (13–19 and 22 in `issues/`) are all implemented and resolved. Those are build work, not decision tickets, and were never part of this map's frontier. Only the manual acceptance checks in § Done when remain.

## Destination

A decision-complete v0 spec at [spec.md](spec.md), with every open technical question resolved and ready for `/to-tickets`. The build is not part of this map.

## Notes

- Domain: a Telegram userbot that evaluates rental Posts from Watched channels against Criteria. Vocabulary is in [CONTEXT.md](../../CONTEXT.md); use it.
- Skills: `domain-modeling` every session. `research` for mtcute and AI Gateway facts. `grilling` for decisions.
- Standing preferences: simplicity wins every tradeoff. mtcute is alpha, so pin exact versions and check its docs and source, never memory. Tests exist so agents can check their own work; final acceptance is manual.
- Baseline: [spec.md](spec.md) starts as the owner's original high-level spec and is updated only by [Lock the decision-complete spec](issues/07-lock-the-spec.md).

## Decisions so far

- [Charting decisions](issues/01-charting-decisions.md): destination = decision-complete spec. Notify then mark. One Post at a time. Criteria re-read every time. 3 attempts (2s/4s; the 60s per-call timeout later became 180s per agent run). Startup membership warning (the `resolve-channels` command was later dropped from v0). Latest Gemini Flash, no prompt tuning. vitest + msw + in-memory SQLite behind a fake Telegram interface. Latest Node, pnpm, tsx.
- [AI Gateway facts for the Evaluator](issues/03-ai-gateway-facts.md): `google/gemini-3.8-flash` via `ai@7.0.107` `generateText` + `Output.object` (zod 4), `maxRetries: 0`, ~$0.01 per 6-photo Post; msw-able (one POST per call), but fixtures are SDK-version-bound and timeouts/401s have quirky error shapes.
- [Runtime and Docker facts](issues/04-runtime-and-docker-facts.md): `node:26.9.0-trixie-slim`, better-sqlite3 13 prebuilt arm64 (no toolchain; the spec later pinned 12.12.0 instead, see [Lock the decision-complete spec](issues/07-lock-the-spec.md)), tsx kept, pnpm 12 via npm with `allowBuilds: false` for better-sqlite3/esbuild; `compose run --rm` is interactive by default; stop the daemon before login.
- [mtcute facts for the Telegram Client](issues/02-mtcute-facts.md): pin `@mtcute/node`/`dispatcher` 0.32.1; albums only via `onMessageGroup` but can split past 250ms; `Message.link` builds links; photos via `getThumbnail('y')`; better-sqlite3 session storage; catchUp has gaps for unopened channels.
- [Liveness signal](issues/10-liveness-signal.md): one `🟢 started, watching N/M channels` message to `me` (plus unjoined IDs), no heartbeat; startup send failure crashes, runtime send failure is logged with the link and skipped; one log line per Post with link, Verdict and reason.
- [Startup recovery of missed Posts](issues/08-startup-recovery.md): no recovery, the bot only looks forward. `catchUp: false`; whatever mtcute delivers after a wake is evaluated as-is. Dedupe Store kept, re-checked when the queue takes a Post. No manual gap checks.
- [Evaluator contract and failure classes](issues/06-evaluator-contract.md) (partly superseded by [Agentic Evaluator](issues/20-agentic-evaluator.md)): rules + Criteria in system, Post text as marked data in user; `reason` in the Criteria's language, any length; every error retries (no classes); photo failures skipped, not retried; empty Post is *no match* without a call; ⚠️ shows `<label>: <first line>`; Notifier caps at 4096; log usage and latency; six msw fixtures with an injected retry policy.
- [Telegram boundary and Post shape](issues/05-telegram-boundary.md): 4-method pipeline interface (`onPost`, `downloadPhoto`, `sendToMe`, `joinedChannelIds`); Post carries marked `chatId`, `Message.link` and lazy photo handles (`y→x→largest`, photos only, ≤6); one identity key per Post (album = grouped ID), checked at dequeue, grouping interval 1000ms; dedupe in a separate `bot.sqlite` `processed_posts` table; empty Posts and service messages are dropped.
- [Geocoding and district boundary facts for Batumi](issues/11-geocoding-facts.md): public Nominatim works (11/14 exact hits across Latin, Cyrillic and Georgian; needs a clean street + number; policy: 1 req/s, User-Agent, cache, attribution). OSM Old Batumi 12695439 + Rustaveli 12695438 polygons, tested point-in-polygon, never Nominatim's district label. Street-only addresses use each street's precomputed share inside the zone.
- [Judging the district from a Post's address](issues/12-district-judgement.md) (superseded by [Agentic Evaluator](issues/20-agentic-evaluator.md); the LocationIQ and OSM facts still hold): one model call returns up to 3 `places` queries (landmark, street + number, street; later amended from a single `address`); on a match, code geocodes them in order with LocationIQ (one attempt each, stop at the first `building`/`venue` hit) and applies a **Zone veto** if the point falls outside the OSM Old Batumi + Rustaveli GeoJSON on the data volume. If the Zone can't be checked, the match goes out with `⚠️ zone not checked: …`. The Criteria keep the district line.
- [Docker and compose layout](issues/09-docker-layout.md): `./data` bind mount with fixed `session.sqlite` + `bot.sqlite`, `CRITERIA_PATH`/`ZONE_PATH` defaults under `data/`; starting files in `data.example/`, copied by hand, missing file crashes; one `tsx src/main.ts` entrypoint with a `login` subcommand, daemon never prompts; stop the service before login; `--prod` install, better-sqlite3 smoke check, `USER node` (bind-mount write checked at acceptance).
- [Lock the decision-complete spec](issues/07-lock-the-spec.md): [spec.md](spec.md) is locked and ready for `/to-tickets`. Gaps closed while locking: a `venue` hit counts as `building` for the Zone veto; an unreadable Criteria file gives a ⚠️ per Post; photos download once, before the first attempt; `MODEL_ID` defaults to Gemini 3.8 Flash; every Done-when check is marked Auto or Manual.
- [Agentic Evaluator facts (AI SDK tools + Gemini)](issues/21-agentic-evaluator-facts.md): one `generateText` can combine tools + `isStepCount` + `Output.object` (Gemini 3 only; output parsed from the last step; force `toolChoice: 'none'` on the last step or risk `NoOutputGeneratedError`); `timeout` is total, `{ stepMs, toolMs }` exist; photos resent every step (~$0.02 per 3-step run, implicit caching unverified via gateway); `MockLanguageModelV4` from `ai/test` scripts runs; `result.steps` / `onStepEnd` give the trace. Not yet checked live.
- [Agentic Evaluator](issues/20-agentic-evaluator.md): the Evaluator becomes an agent run (Post + photos in, `geocode`/`inZone` tools, `{ match, notes }` out) that **owns the Verdict**; no code veto, so **Zone veto** leaves the glossary. Tool shapes are ours (LocationIQ behind an adapter), tool errors go back to the model, the prompt moves to an editable `data/prompt.md`, 8 steps and 180s per run with the 3-attempt policy around it, Sentry AI monitoring (optional `SENTRY_DSN`), and agent tests use `ai/test`'s mock model. Verified live on the DS Mall Post: the agent geocoded, checked the Zone and returned *no match*.
- [Sentry AI monitoring and error reporting](issues/22-sentry-observability.md): implemented optional `@sentry/node` AI telemetry and best-effort error reporting with Post-link context, redaction, and unchanged console logging; automated checks pass, with only the real-Post acceptance run remaining.

## Not yet specified

_Nothing left in the fog. Both earlier patches became tickets, now resolved: [Docker and compose layout](issues/09-docker-layout.md), [Liveness signal](issues/10-liveness-signal.md)._

## Out of scope

- Everything in the spec's "Out of scope" list: history backfill, listing-level dedupe, per-criterion rating cards, a separate Bot API bot, handling edits and deletes, automatic channel joining, a `resolve-channels` command.
- Hosting anywhere other than the owner's laptop.
- Multiple Criteria files or profiles.
- Prompt tuning against sample Posts (ruled out while charting).
