# The bot only looks forward

The bot runs on the owner's laptop, so it is down every night, every time the lid closes, and after every crash. mtcute's `catchUp` turned out not to cover those gaps honestly — after a long gap Telegram returns only the latest messages, and a crash mid-handler can advance the saved position past a Post that was never evaluated — and the alternative, fetching the last N messages of every Watched channel at startup, means a burst of history calls across 10–20 channels for Posts that are mostly stale by the time anyone reads them. So the client runs with `catchUp: false` and there is no startup history fetch: the bot evaluates what arrives while it is running, and Posts published while it was down are gone for good.

## Consequences

- Every restart is a hole in coverage. That is the reason the things the owner tunes routinely live in files rather than environment variables ([ADR-0005](0005-owner-edited-files.md)), and the reason nothing restarts the bot automatically ([ADR-0004](0004-nothing-restarts-the-bot.md)).
- Whatever mtcute's own gap handling delivers after a wake from sleep is evaluated like any other Post. It is not filtered by date, so a wake sometimes brings a few extra Posts and sometimes none.
- The record of Processed Posts is still needed. It is not there for recovery but because Telegram can deliver the same message twice and a restart must never re-evaluate a Processed Post.
