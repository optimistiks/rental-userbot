# Lock the decision-complete spec

Type: task
Status: resolved
Blocked by: 04, 05, 06, 08, 09, 10, 12

## Question

Fold every resolved decision on the map into `.scratch/rental-userbot/spec.md`, so that nothing is left to decide before `/to-tickets`. This covers pinned versions, the model ID, the Telegram boundary, the Evaluator contract, the test strategy, the Docker setup, the `resolve-channels` command and the startup membership check. Every "Done when" item should be marked as either covered by automated tests or part of the manual acceptance run. Run it past the owner before resolving.

Also fold in [Liveness signal](10-liveness-signal.md): it reverses the charting rule about not messaging the owner on unjoined channels, and adds Notifier failure behaviour the spec lacks (crash on a failed startup send, log-and-skip on a failed runtime send).

Also fold in [Judging the district from a Post's address](12-district-judgement.md): the `address` output field, the Zone veto step after a match, the Zone file, the LocationIQ call and its failure handling, the `⚠️ zone not checked` line on match messages, the new settings (`ZONE_PATH`, `LOCATIONIQ_TOKEN`, `GEOCODER_URL`) and the new fixtures.

## Answer

Locked with the owner (2026-09-20). [spec.md](../spec.md) is rewritten as the decision-complete v0 spec. It folds in every resolved ticket and links each one from the section it shaped.

Gaps no earlier ticket decided, settled here:
- **`venue` counts as `building`.** A LocationIQ POI-level hit can trigger the Zone veto too. The **Zone veto** entry in [CONTEXT.md](../../CONTEXT.md) now reads "placed precisely (a building or a named place)". This widens [Judging the district from a Post's address](12-district-judgement.md), which said building only.
- **Criteria read failure at runtime** is an evaluation failure: a ⚠️ per Post, no model call, no retry. This mirrors the Zone file.
- **Photos are downloaded once, before the first model attempt.** [Evaluator contract and failure classes](06-evaluator-contract.md) skip-and-log rule overrides the download-per-attempt rule in [Telegram boundary and Post shape](05-telegram-boundary.md).
- `MODEL_ID` is optional and defaults to `google/gemini-3.8-flash`. better-sqlite3 is pinned to 12.11.1. zod 4 gets its exact pin at install time.
- A Zone veto sends nothing. The startup order is settings → files → `bot.sqlite` → session → membership → 🟢 → stream.
- Each of the 16 "Done when" checks is marked Auto, Manual or both.

Nothing is left to decide. Next step: `/to-tickets` on the spec.
