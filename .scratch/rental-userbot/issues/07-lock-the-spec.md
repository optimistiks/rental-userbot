# Lock the decision-complete spec

Type: task
Status: open
Blocked by: 04, 05, 06, 08, 09, 10, 12

## Question

Fold every resolved decision on the map into `.scratch/rental-userbot/spec.md`, so that nothing is left to decide before `/to-tickets`. This covers pinned versions, the model ID, the Telegram boundary, the Evaluator contract, the test strategy, the Docker setup, the `resolve-channels` command and the startup membership check. Every "Done when" item should be marked as either covered by automated tests or part of the manual acceptance run. Run it past the owner before resolving.

Also fold in [Liveness signal](10-liveness-signal.md): it reverses the charting rule about not messaging the owner on unjoined channels, and adds Notifier failure behaviour the spec lacks (crash on a failed startup send, log-and-skip on a failed runtime send).

Also fold in [Judging the district from a Post's address](12-district-judgement.md): the `address` output field, the Zone veto step after a match, the Zone file, the LocationIQ call and its failure handling, the `⚠️ zone not checked` line on match messages, the new settings (`ZONE_PATH`, `LOCATIONIQ_TOKEN`, `GEOCODER_URL`) and the new fixtures.
