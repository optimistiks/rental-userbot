# Startup recovery of missed Posts

Type: grilling
Status: open
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
