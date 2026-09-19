# Lock the decision-complete spec

Type: task
Status: open
Blocked by: 04, 05, 06, 08, 09, 10

## Question

Fold every resolved decision on the map into `.scratch/rental-userbot/spec.md`, so that nothing is left to decide before `/to-tickets`. This covers pinned versions, the model ID, the Telegram boundary, the Evaluator contract, the test strategy, the Docker setup, the `resolve-channels` command and the startup membership check. Every "Done when" item should be marked as either covered by automated tests or part of the manual acceptance run. Run it past the owner before resolving.
