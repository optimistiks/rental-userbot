# Liveness signal

Type: grilling
Status: resolved
Blocked by: —

## Question

The bot is silent unless there's a Match or an evaluation failure, and it's down whenever the laptop sleeps. How does the owner know it's alive and watching?

Options: Docker logs only, as the spec has it. A short message to `me` on startup, listing the Watched channels found and missing. A periodic heartbeat. Or rule this out of scope for v0.

## Answer

Decided with the owner (2026-09-19).

- **Signal:** one startup message to `me`. No heartbeat, no message edited in place. It says nothing after laptop sleep (Docker's VM pauses, the process doesn't restart); that is accepted.
- **Startup message format:**
  ```
  🟢 started, watching 14/15 channels
  not joined: -1001234567890
  ```
  The second line appears only when some `CHANNEL_IDS` aren't joined. This **reverses** the charting decision in [Charting decisions](01-charting-decisions.md) that the bot never messages the owner about unjoined channels. They are still logged as a warning too.
- **Restart loops:** no suppression. Repeated 🟢 messages are themselves the alarm.
- **Startup send fails:** the process crashes. If it can't reach `me`, there is no reason to start.
- **Runtime send fails** (Match or ⚠️ entry): log an error including the Post link, mark the Post processed, keep running. A temporary loss of connectivity is not a reason to crash; the bot has already proved it can send. This **narrows** the charting rule "losing a match is not accepted": a Match lost this way survives only in the logs.
- **Logs** (plain `console`, to Docker logs):
  - one line at startup: channels found and missing;
  - one line per Post: its link, the Verdict, and the reason or error, so the owner can open the Post straight from the terminal.
