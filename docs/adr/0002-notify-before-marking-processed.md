# Notify before marking a Post processed

A Post is sent to Saved Messages first and recorded as a Processed Post afterwards. The two cannot be made atomic, so one of them has to go first, and the failure modes are not symmetric: marking first means a crash in between loses a Match silently and forever, while notifying first means a crash in between produces a duplicate entry in Saved Messages. The owner would rather delete a duplicate than never learn about a flat, so notification wins.

## Consequences

- A Post is marked processed after the Notifier whatever the Verdict, and whether or not the send succeeded. A send that fails at runtime is logged with the Post link and the bot moves on; that Match survives only in the logs. The alternative — retrying or leaving the Post unprocessed — reopens the same window this ADR closes, for a failure the bot has no way to fix.
- Each Post gets exactly one pass. Nothing is retried once the Notifier has run.
- Identity is per Post, not per message: an album is one key built from its grouped ID. While a Post is queued or being evaluated its key is held in memory, so a second copy that arrives before the first finishes is dropped ([ADR-0006](0006-model-work-is-concurrent-telegram-work-is-serial.md)). A late album fragment therefore finds its album already processed and is dropped with it, losing its photos.
