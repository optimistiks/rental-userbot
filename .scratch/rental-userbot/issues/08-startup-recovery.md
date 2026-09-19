# Startup recovery of missed Posts

Type: grilling
Status: resolved
Blocked by: —

## Question

The mtcute research found that `catchUp` is weaker than the spec assumes for our Watched channels:
- after a long gap, Telegram returns only the latest messages, so the rest are lost;
- whether a channel that never posted while the bot was running gets its missed Posts recovered is unverified;
- a crash mid-handler can advance the saved position past an unprocessed message.

The suggested fix is to fetch the last N messages of each Watched channel at startup (read-only history call) and let the Dedupe Store drop the ones already seen.

Decide:
- Keep the spec as written (catchUp only; accept losses), or add the startup fetch?
- If we add it: what N or time window? What happens on the **first** run, when the dedupe table is empty (evaluate the last N, or record them as seen without evaluating)? What flood-wait cost with 10–20 channels?
- Does this conflict with "backfill of channel history" being out of scope, or is it a different thing (a bounded catch-up, not history)?
- Should the manual acceptance run include a check for quiet channels (stop the bot, post, restart)?

## Answer

Decided with the owner (2026-09-19). **No recovery: the bot only looks forward.** When it starts, or the laptop wakes, it works from the next thing posted.

- **`catchUp: false`.** At startup mtcute moves its saved position to "now" without dispatching anything, so Posts published while the bot was down are never evaluated. There is no startup history fetch and no recovery on reconnect.
- **Wake from sleep:** whatever mtcute's own gap handling delivers when the connection comes back is evaluated like any other Post. We don't filter it by date or track connection state. Sometimes this means a few extra Posts from the sleep, sometimes none. Accepted.
- **Accepted losses:** Posts published while the process is down, the older part of a long gap after a wake, and a Post in flight when the process crashes.
- **Dedupe Store stays.** It still guarantees a restart never re-evaluates a processed message, and mtcute can still deliver the same message twice.
- **Second dedupe check when the queue takes a Post.** The early check before queueing stays as a cheap filter. The queue runs one Post at a time and marks each processed before the next starts, so a second copy queued before the first was marked is dropped.
- **No manual gap checks** in the acceptance run.
- The "is a quiet channel recovered?" uncertainty from the mtcute research is moot.

For [Lock the decision-complete spec](07-lock-the-spec.md): change `catchUp: true` to `false` in [1] Telegram Client. Rewrite the Deployment line "Posts from those gaps are recovered only as far as `catchUp` reaches" as "Posts from those gaps are not recovered". Add the second check to [3] Dedupe Store. Add "recovery of Posts published while the bot is down" to the spec's Out of scope list.
