# Nothing restarts the bot

The compose service runs with `restart: "no"`, so a crash or a reboot leaves the bot down until the owner starts it by hand. This is the opposite of the obvious setting for a daemon, and it is deliberate: the bot is logged in to the owner's personal Telegram account, and the pattern most likely to get an account limited is a crash loop — a bad config or a flood wait turning into an endless cycle of handshakes, dialog scans and self-messages. An account limited for that costs more than a missed window of Posts, which is already an accepted loss ([ADR-0001](0001-only-look-forward.md)).

The same reasoning drives the rest of the account-safety posture: the bot never joins, leaves or opens a chat and only ever writes to Saved Messages; it sleeps through flood waits of up to five minutes rather than throwing; it takes a session lock at startup so the daemon and `login` can never use one auth key at once, which Telegram answers by revoking the session; and it pins a stable device identity so an mtcute upgrade does not change how the session looks under Telegram's Devices.

## Consequences

- The 🟢 startup message is how the owner knows it is running. Its absence is the alarm; there is no heartbeat.
- A failed startup send crashes the process on purpose: if the bot cannot reach Saved Messages, there is no point in it running.
