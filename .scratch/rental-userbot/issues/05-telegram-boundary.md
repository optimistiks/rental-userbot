# Telegram boundary and Post shape

Type: grilling
Status: resolved
Blocked by: 02

## Question

Given the mtcute facts, where exactly do we draw the in-house Telegram interface that tests fake, and what does a Post look like when it crosses it?

- The Post type as it leaves the Telegram adapter: chat ID form, message IDs, text, photo handles (lazy download vs eager bytes), and channel username for links.
- Whether the adapter turns single messages and albums into one Post stream, and how it avoids double delivery if mtcute can emit both.
- The adapter's method set: the Post stream, photo download, send text to `me`, list or resolve channels for `resolve-channels` and the startup check. Which of these the core pipeline sees and which only the commands see.
- The dedupe storage choice: same SQLite driver or file as the mtcute session, or separate. The table shape, including how albums mark every message ID.
- **Split albums** (from the mtcute research): an album part arriving more than 250ms after the first comes as a second message-group event with different message IDs. Decide how a Post is kept to exactly one evaluation: dedupe by the album's grouped ID, a longer or sliding grouping wait of our own, or accept a rare double evaluation.
- Photo bytes arrive as `Uint8Array`, and the "standard" size is `getThumbnail('y')`. Decide how the Listing's `photos` type and download size follow from that.

## Answer

Decided with the owner (2026-09-19), based on [mtcute facts for the Telegram Client](02-mtcute-facts.md).

**Boundary**
- There is one small interface for the pipeline only, faked in tests: `onPost(handler)`, `downloadPhoto(ref)`, `sendToMe(text)`, `joinedChannelIds()`. The last one feeds the startup warning, so that warning is testable.
- `resolve-channels` calls mtcute directly. It is not on the interface and is only checked by hand.

**Post shape**
```ts
type Post = {
  chatId: number        // marked form, -100…; same form as CHANNEL_IDS and resolve-channels output
  messageIds: number[]  // ascending
  albumId?: string      // mtcute groupedIdUnique, albums only
  text: string          // non-empty captions joined with "\n\n", may be ""
  photos: PhotoRef[]    // opaque handles
  link: string          // Message.link of the first message
}
```
- The adapter turns `onNewMessage` and `onMessageGroup` into one Post stream. Albums never arrive through both.
- The link comes from `Message.link`. The username never leaves the adapter, and the spec's hand-written link format and its unit test are dropped.
- The Channel Filter stays in core as a pure function on `chatId`.
- The adapter drops service messages (pins, photo changes, …). They never become Posts.
- A Post with no text and no photos is dropped in core before the queue. It is logged but not recorded as processed.

**Photos**
- Handles are lazy and downloaded inside each Evaluator attempt, so a download failure counts toward the 3 attempts. On `FILE_REFERENCE_EXPIRED`, the message is not re-fetched and the attempt just fails.
- Size: `getThumbnail('y') ?? getThumbnail('x') ?? photo`. Type `Uint8Array` (this replaces the spec's `Buffer[]`).
- Only `media.type === 'photo'` counts. Videos and documents are skipped, thumbnails included. Keep the first 6 photos in message order.

**Split albums and Post identity**
- Each Post has one identity key: `<chatId>:<messageId>` for a single message, `<chatId>:album:<groupedId>` for an album. It is built by one pure function in core, with a unit test.
- The key is checked when a Post is **dequeued**, not when it arrives. Posts are processed one at a time and marked after the notification is sent, so a late album fragment finds its album already processed and is dropped. Its extra photos are lost, and that is accepted.
- `messageGroupingInterval` goes up to **1000ms** so splits are rarer.
- This replaces the spec's rule "every message ID in the album is marked".

**Dedupe storage**
- A separate SQLite file, `bot.sqlite`, sits beside mtcute's session file and is opened with better-sqlite3 as a direct dependency pinned to mtcute's version. It does not use mtcute's migration hooks. Re-login by deleting the session does not wipe the history. Tests pass `:memory:`.
- Table:
  ```sql
  CREATE TABLE processed_posts (
    post_key     TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL  -- unix ms, debugging only
  );
  ```
  There is no verdict column. Saved Messages and the Docker logs already record outcomes.
- Version note for [Lock the decision-complete spec](07-lock-the-spec.md): mtcute 0.32.1 depends on `better-sqlite3 ^12.10.0`, while [Runtime and Docker facts](04-runtime-and-docker-facts.md) checked 13.0.3. Pin the direct dependency to mtcute's 12.x so only one native build is installed. The prebuilt-arm64 check applies to 12.x as well (mtcute research: 12.11.1 has linux-arm64 prebuilds for Node 22–26).
