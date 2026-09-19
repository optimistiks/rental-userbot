# Rental Listings Userbot — v0 Spec

A Telegram userbot, logged in to the owner's personal account, that watches apartment rental channels, judges each new post against a criteria file with a vision model, and saves a link to every match in the owner's Saved Messages.

v0 goal: a working pipeline end to end. Simplicity wins every tradeoff.

## Stack

- TypeScript, Node.js
- `@mtcute/node` + `@mtcute/dispatcher` (MTProto client). mtcute is alpha: pin exact versions.
- Vercel AI Gateway, vision-capable model, model ID from config
- SQLite (mtcute's default Node storage) for the session and app state
- Docker Compose on the owner's laptop, one long-lived process

## Pipeline

```
Telegram (MTProto updates)
  → [1] Telegram Client
  → [2] Channel Filter
  → [3] Dedupe Store (check)
  → [4] Listing Assembler
  → [5] Evaluator
  → [6] Notifier
  → [3] Dedupe Store (mark processed)
```

Each box is a module with the inputs and outputs below. Internals are the implementer's call.

## Components

### [1] Telegram Client

- **In:** `API_ID`, `API_HASH`, SQLite session file on the data volume
- **Out:** stream of new messages and message groups (albums) from all chats the account receives
- **Rules:**
  - Update settings: `catchUp: true` (best-effort cover for restarts), `messageGroupingInterval: 250` (one album = one event).
  - First run is an interactive login (phone, code, 2FA password) via `docker compose run` with a TTY. Later runs reuse the session.
  - The account stays read-only toward the world: it sends messages only to `me` and never joins, leaves, or opens chats. Channels are joined manually by the owner. `openChat` stays unused (10–20 channels exceeds mtcute's safe limit; slightly delayed updates are acceptable).

### [2] Channel Filter

- **In:** message or message group; `CHANNEL_IDS` from env
- **Out:** the same event if its chat ID is in `CHANNEL_IDS`, otherwise dropped
- **Rules:** new messages only. Edits and deletes are ignored.

### [3] Dedupe Store

- **In:** `(chat_id, message_id)` pairs
- **Out:** `seen: boolean`; a mark-processed operation
- **Rules:**
  - SQLite, on the same data volume as the session.
  - For an album, every message ID in the group is marked processed.
  - A message is marked processed after the Notifier step completes, whether the outcome was match, no match, or evaluation failure. Nothing is retried after that.
  - Message-level only. Cross-posted duplicates of the same flat are out of scope for v0.

### [4] Listing Assembler

- **In:** message or message group
- **Out:** `Listing`:
  ```ts
  {
    chatId: number
    messageIds: number[]
    text: string        // caption/body, original language, may be empty
    photos: Buffer[]    // up to first 6 photos, standard Telegram size; may be empty
    link: string        // link to the first message of the post
  }
  ```
- **Rules:**
  - Link format: public channel `https://t.me/<username>/<messageId>`; private channel `https://t.me/c/<internalId>/<messageId>` where `internalId` is the channel ID without the `-100` prefix.
  - Posts without photos pass through with `photos: []`.

### [5] Evaluator

- **In:** `Listing` (text + photos), criteria file contents, `MODEL_ID`, `AI_GATEWAY_API_KEY`
- **Out:** `{ match: boolean, reason: string }`, or an error after retries
- **Rules:**
  - Criteria file is plain text, injected into the prompt as-is. Changing criteria means editing the file, no code change.
  - Structured output: the model returns exactly `{ match, reason }`. `reason` is one line.
  - **Lenient matching:** a listing matches unless it clearly violates a criterion. Missing or unstated information never causes a rejection.
  - Posts that are not rental offers (ads, "looking for" posts, sales listings) are non-matches.
  - Captions go to the model in their original language (commonly Russian, Georgian, English).
  - Retry 3× with backoff on timeout, gateway error, photo download failure, or unparseable output. After the final failure, emit the error to the Notifier.

### [6] Notifier

- **In:** `link` + one of: `reason` (match), error message (evaluation failed); nothing on non-match
- **Out:** one text message to `me` (Saved Messages)
- **Format:**
  - Match: `<link>\n<reason>`
  - Failure: `<link>\n⚠️ couldn't evaluate: <error>`
- **Rules:** text only. The original post is never forwarded.

## Configuration

`.env`:

| Var | Meaning |
|---|---|
| `API_ID`, `API_HASH` | from my.telegram.org |
| `CHANNEL_IDS` | comma-separated channel IDs to watch |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key |
| `MODEL_ID` | vision-capable model ID on the gateway |
| `CRITERIA_PATH` | path to the criteria file |

Session file, dedupe DB, and criteria file live on one mounted data volume.

## Initial criteria file

```
Apartment for long-term rent in Batumi, Georgia.
- 1+1 (one bedroom + living room) or larger
- Rent at most $800/month; up to $900 only if the apartment is exceptional
- Located in Old Town or Rustaveli district only
- Clean, modern interior; reject tacky or dated "grandma-style" interiors
- Central gas heating
- View does not face other windows or a wall
- Not on the first floor
```

## Deployment

- Runs on the owner's laptop. `docker-compose.yml` with one service, `restart: unless-stopped`, data volume mounted.
- The process is down while the laptop sleeps or is off. Posts from those gaps are recovered only as far as `catchUp` reaches; losing some is acceptable for v0.
- Documented first-run login command.
- Secrets only in `.env`; `.env` and the data volume stay out of git. The session file grants full account access.

## Out of scope for v0

Backfill of channel history · listing-level dedupe · per-criterion rating cards · a separate Bot API bot for push notifications · handling edits/deletes · automatic channel joining.

## Done when

- Fresh deploy: interactive login succeeds; restart reuses the session without prompting.
- A new text-only post in a watched channel is evaluated.
- A new album in a watched channel is evaluated once, with its photos.
- A post in an unwatched chat is ignored.
- A match produces exactly one Saved Messages entry with a working link and reason.
- A forced model failure produces one `⚠️ couldn't evaluate` entry after 3 retries.
- Restarting the container never re-evaluates an already-processed message.
