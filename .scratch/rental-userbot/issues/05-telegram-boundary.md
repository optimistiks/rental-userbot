# Telegram boundary and Post shape

Type: grilling
Status: open
Blocked by: 02

## Question

Given the mtcute facts, where exactly do we draw the in-house Telegram interface that tests fake, and what does a Post look like when it crosses it?

- The Post type as it leaves the Telegram adapter: chat ID form, message IDs, text, photo handles (lazy download vs eager bytes), and channel username for links.
- Whether the adapter turns single messages and albums into one Post stream, and how it avoids double delivery if mtcute can emit both.
- The adapter's method set: the Post stream, photo download, send text to `me`, list or resolve channels for `resolve-channels` and the startup check. Which of these the core pipeline sees and which only the commands see.
- The dedupe storage choice: same SQLite driver or file as the mtcute session, or separate. The table shape, including how albums mark every message ID.
- **Split albums** (from the mtcute research): an album part arriving more than 250ms after the first comes as a second message-group event with different message IDs. Decide how a Post is kept to exactly one evaluation: dedupe by the album's grouped ID, a longer or sliding grouping wait of our own, or accept a rare double evaluation.
- Photo bytes arrive as `Uint8Array`, and the "standard" size is `getThumbnail('y')`. Decide how the Listing's `photos` type and download size follow from that.
