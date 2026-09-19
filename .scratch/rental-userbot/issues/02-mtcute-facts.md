# mtcute facts for the Telegram Client

Type: research
Status: resolved
Blocked by: —

## Question

What do the current `@mtcute/node` + `@mtcute/dispatcher` releases actually provide for our needs? Answer from their docs and source, not from memory, and cite the version checked. Specifically:

1. **Versions.** Latest published versions of `@mtcute/node` and `@mtcute/dispatcher` (and any other `@mtcute/*` packages needed), and whether they must be pinned together.
2. **Updates.** How `catchUp: true` and `messageGroupingInterval` are configured. What `catchUp` recovers after downtime (how far back, and which chats, given that we never call `openChat`). How the dispatcher delivers albums (a message-group handler, and its shape), and whether the same messages can *also* arrive through the single-message handler. How to subscribe to *new* messages only (no edits or deletes).
3. **Channel ID format.** How a message's chat ID is represented (marked `-100…` form or bare), so `CHANNEL_IDS` and the `t.me/c/<internalId>` link can be derived correctly. How to get a channel's public username for `t.me/<username>/<id>` links.
4. **Photos.** How to download a message photo into a `Buffer`, and which size counts as the "standard" size (not the original, not a thumbnail). Behaviour for messages whose media isn't a photo (video, document).
5. **Sending.** How to send a plain text message to `me`/Saved Messages, and how to turn off link previews if possible.
6. **Login.** How the interactive first-run login works in a plain TTY (phone, code, 2FA password) with `client.start()` or equivalent, and how session reuse is detected on later runs.
7. **Read-only lookups** for `resolve-channels` and the startup membership check. How to resolve a `@username` or `t.me/...` link to a channel without joining it. How to list joined dialogs and match them by title. Which of these calls carry a flood-wait risk.
8. **Storage.** Which SQLite driver the default Node storage uses (`better-sqlite3`, `node:sqlite`, other), where the file goes, and whether our own dedupe table can reasonably use the same driver or file. Any native-module implications.
9. **Stability notes.** Known alpha caveats, breaking-change notes, or open issues that affect the above.

Write findings to `.scratch/rental-userbot/research/mtcute.md`.

## Answer

Findings are in [research/mtcute.md](../research/mtcute.md), based on the published 0.32.1 source, mtcute's docs and release notes, and core.telegram.org.

- **Versions:** `@mtcute/node` and `@mtcute/dispatcher` 0.32.1, both depending on `@mtcute/core ^0.32.1`. Pin both exactly. Requires Node 22+.
- **Updates:** configured as `updates: { catchUp: true, messageGroupingInterval: 250 }`. Album messages reach only `onMessageGroup` (a list of messages), never `onNewMessage`. Edits and deletes don't reach the new-message handlers.
- **Links:** chat IDs are marked (`-100…`); bare ID = `-1e12 - id`. `Message.link` already builds both link forms, and `Chat.username` gives the username.
- **Photos:** `downloadAsBuffer` returns a `Uint8Array`, and by default downloads the largest size. "Standard" = `getThumbnail('y')` (1280px) or `'x'` (800px). Filter on `media.type === 'photo'`. Issue #40: expired file references aren't refreshed, so download promptly.
- **Sending:** `sendText('me', text, { disableWebPreview: true })`. The bot doesn't receive its own sent message back.
- **Login:** `start()` prompts in the TTY and succeeds silently when the saved session is valid.
- **Lookups:** `resolvePeer`/`getChat` work without joining, but don't parse `https://t.me/<name>`; strip that ourselves. `iterDialogs` needs `archived: 'keep'`. Flood waits up to 10s are retried automatically.
- **Storage:** better-sqlite3, file `client.session` in the working directory by default. Dedupe can share the file through storage hooks or use its own file.

**Contradicts the plan:**
- **Albums can split.** The grouping timer isn't sliding, so an album part arriving more than 250ms after the first comes as a second group event with different message IDs. Message-ID dedupe won't catch this. Moved to [Telegram boundary and Post shape](05-telegram-boundary.md).
- **catchUp gaps.** When too much is pending, Telegram returns only the latest posts, so older ones are lost. Whether missed posts in a channel that never posted while the bot ran are recovered is unverified. catchUp can also replay messages, and a crash mid-handler can lose one. Moved to [Startup recovery of missed Posts](08-startup-recovery.md).
