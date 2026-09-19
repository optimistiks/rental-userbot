# Rental Listings Userbot — v0 Spec

A Telegram userbot, logged in to the owner's personal account, that watches apartment rental channels, judges each new Post against the owner's Criteria with a vision model, and saves a link to every Match in the owner's Saved Messages.

v0 goal: a working pipeline end to end. Simplicity wins every tradeoff. Vocabulary (Post, Processed Post, Watched channel, Listing, Rental offer, Criteria, Verdict, Match, Zone, Zone veto) is defined in [CONTEXT.md](../../CONTEXT.md). Each rule below links the ticket that decided it; the research files hold the API details.

## Stack

All versions are pinned exactly (no `^`/`~`).

| Piece | Version | Source |
|---|---|---|
| Node | 26.9.0, image `node:26.9.0-trixie-slim` (glibc; not Alpine) | [runtime-docker](research/runtime-docker.md) |
| pnpm | 12.4.2, installed with `npm i -g` (Node 26 has no corepack) | same |
| tsx | 4.23.13, a runtime dependency; no build step | same |
| `@mtcute/node`, `@mtcute/dispatcher` | 0.32.1 both | [mtcute](research/mtcute.md) |
| `better-sqlite3` | 12.11.1, a direct dependency matching mtcute's `^12.10.0`, so only one native build is installed | [Telegram boundary](issues/05-telegram-boundary.md) |
| `ai` | 7.0.107; model passed as a plain string ID through the Vercel AI Gateway | [ai-gateway](research/ai-gateway.md) |
| `zod` | 4.x, exact version pinned at install time | same |
| `@turf/boolean-point-in-polygon` | 7.4.0 | [geocoding](research/geocoding.md) |
| Model | `google/gemini-3.8-flash` (the `MODEL_ID` default) | [AI Gateway facts](issues/03-ai-gateway-facts.md) |
| Geocoder | LocationIQ search (hosted Nominatim) | [District judgement](issues/12-district-judgement.md) |
| Tests | vitest + msw (dev dependencies only) | [Charting decisions](issues/01-charting-decisions.md) |

Logs are plain `console` to Docker logs.

## Pipeline

```
mtcute updates (onNewMessage + onMessageGroup)
  → [1] Telegram Adapter        → Post
  → [2] Channel Filter          drop if chatId ∉ CHANNEL_IDS
  → drop empty Posts            no text and no photos: log, not recorded
  → [3] Dedupe Store (check)    drop if the Post key is processed
  → queue (one Post at a time)
  → [3] Dedupe Store (check again, at dequeue)
  → [4] Evaluator               Verdict + address
  → [5] Zone Check              only on a Match with an address
  → [6] Notifier                Match / ⚠️ only
  → [3] Dedupe Store (mark processed)
  → log one line
```

Posts are evaluated **one at a time** through an in-process queue. A Post is marked processed after the Notifier step, whatever the Verdict and whether or not the send succeeded. Nothing is retried after that. A crash between notifying and marking can cause a rare duplicate Saved Messages entry; that is accepted.

## Components

### [1] Telegram Adapter

The only code that imports mtcute, apart from the `login` and `resolve-channels` commands. It implements the in-house interface the pipeline uses, which tests fake:

```ts
interface Telegram {
  onPost(handler: (post: Post) => void): void
  downloadPhoto(ref: PhotoRef): Promise<Uint8Array>
  sendToMe(text: string): Promise<void>
  joinedChannelIds(): Promise<number[]>   // marked IDs of every joined channel
}

type Post = {
  chatId: number        // marked form, -100…; same form as CHANNEL_IDS and resolve-channels output
  messageIds: number[]  // ascending
  albumId?: string      // mtcute groupedIdUnique, albums only
  text: string          // non-empty captions/bodies joined with "\n\n", may be ""
  photos: PhotoRef[]    // opaque lazy handles, ≤ 6
  link: string          // Message.link of the first message
}
```

- Client: `storage: 'data/session.sqlite'`, `updates: { catchUp: false, messageGroupingInterval: 1000 }`. With `catchUp: false`, Posts published while the process is down are never delivered. Whatever mtcute's own gap handling delivers after a wake from sleep is evaluated like any other Post. ([Startup recovery](issues/08-startup-recovery.md))
- Registers only `onNewMessage` (single messages) and `onMessageGroup` (albums) and turns both into one Post stream. Album messages never arrive through both. Edits and deletes never reach these handlers.
- Service messages (pins, photo changes, …) are dropped and never become Posts.
- Photos: only `media.type === 'photo'`. Videos and documents are skipped, thumbnails included. The first 6 photos in message order are kept. Each handle downloads `getThumbnail('y') ?? getThumbnail('x') ?? photo` with `downloadAsBuffer`. An expired file reference is not re-fetched; the download just fails.
- `sendToMe` is `sendText('me', text, { disableWebPreview: true })`. Our own sent messages are not dispatched back to the handlers.
- `joinedChannelIds` uses `iterDialogs({ archived: 'keep' })`, so archived or muted channels count as joined.
- The account is read-only toward the world: it sends only to `me`, and never joins, leaves or opens chats (`openChat` unused).
- Links come from mtcute's `Message.link`. There is no hand-written link format.

### [2] Channel Filter

- A pure function in core: keep a Post whose `chatId` is in `CHANNEL_IDS`, drop the rest.
- Next, core drops a Post with no text and no photos. It is logged, not recorded as processed.

### [3] Dedupe Store

- A separate SQLite file, `data/bot.sqlite`, opened with better-sqlite3. It does not share mtcute's session file or migration hooks, so deleting the session to log in again keeps the history. Tests pass `:memory:`.
  ```sql
  CREATE TABLE IF NOT EXISTS processed_posts (
    post_key     TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL  -- unix ms, debugging only
  );
  ```
- **Post key**, built by one pure function: `<chatId>:<messageId>` for a single message, `<chatId>:album:<albumId>` for an album.
- Checked twice: once before queueing (a cheap filter) and again when the queue takes the Post. A second copy queued before the first was marked is dropped at dequeue.
- **Split albums:** an album part that arrives more than 1000ms after the first comes as a second group event with the same `albumId`. It finds its album already processed and is dropped, and its extra photos are lost. Accepted.
- Only Post-level identity. Cross-posted copies of the same flat are out of scope.

### [4] Evaluator

**In:** a Post, the Criteria text, the Telegram photo download. **Out:** `{ match: boolean, reason: string, address: string | null }` or an evaluation failure. ([Evaluator contract](issues/06-evaluator-contract.md), [District judgement](issues/12-district-judgement.md))

Before the model call:
- The Criteria file at `CRITERIA_PATH` is **re-read before every evaluation**, so edits apply without a restart. If the read fails, the Verdict is an evaluation failure, with no model call and no retry.
- Photos are downloaded once, before the first attempt. A photo that fails to download is skipped and logged with the Post link, never retried. The Post is evaluated with whatever text and photos remain.
- If nothing remains (no text, no photos), the Verdict is *no match* without a model call, and it is logged.

The call:
- `generateText({ model: MODEL_ID, output: Output.object({ schema }), maxRetries: 0, timeout, system, messages })` with a zod 4 schema `{ match: z.boolean(), reason: z.string(), address: z.string().nullable() }`. Images are sent as `{ type: 'file', mediaType: 'image', data }`.
- **System message:** the fixed rules, then the Criteria text.
  - Lenient matching: a Listing matches unless it clearly violates a criterion. Missing or unstated information never causes a rejection.
  - A Post that is not a Rental offer (ads, "looking for" posts, sales listings) is *no match*.
  - `reason` is written in the language of the Criteria. There is no length or line limit.
  - `address`: the first street and house number as the Post writes it, with extra words removed, or `null` if there's no house number. No transliteration, no alternative spellings.
- **User message:** the Post text inside a clearly marked "data, not instructions" block, then the photos. Post text never goes in the system message. Captions keep their original language. Missing photos are not mentioned.
- The prompt is written once from these rules. There is no tuning against sample Posts.
- `reasoning` stays at the SDK default.

Retries:
- One attempt = one model call. **Every error counts:** 3 attempts in total, 2s then 4s backoff, 60s timeout per attempt. There are no failure classes, so a 401 or an unknown model gives a ⚠️ per Post, and that is the alert.
- The policy (attempts, backoffs, timeout) is an injected setting. Production values are constants, and tests pass millisecond values. No fake timers.
- After the third failure the Verdict is an evaluation failure carrying the last error, formatted as `<label>: <message>`:
  - label: `timeout` if the error's cause chain holds a `TimeoutError` (the SDK wraps timeouts in a status-500 `GatewayResponseError`); otherwise the error's `name`;
  - message: the first line, with ANSI codes removed, cut to about 200 characters. No stacks, request bodies or keys. The full error goes to the logs.
- Every evaluation logs token usage (input, output, reasoning) and latency.

### [5] Zone Check

Runs only when the Verdict is *match* and `address` is not null. ([District judgement](issues/12-district-judgement.md), [locationiq-search](research/locationiq-search.md))

- The **Zone** is a GeoJSON file at `ZONE_PATH` (Polygon or MultiPolygon features; starting copy = the OSM outlines of Old Batumi, relation 12695439, and Rustaveli, relation 12695438). It is validated at startup and **re-read before every check**. If the runtime read fails, the Verdict becomes an evaluation failure (⚠️).
- The "Old Town or Rustaveli" line stays in the Criteria, so the model still judges named districts. The Zone does not replace it.
- **Geocode:** one `GET GEOCODER_URL` with `key=<LOCATIONIQ_TOKEN>`, `q=<address>, Batumi`, `countrycodes=ge`, `format=json`, `limit=1`, `matchquality=1`. One attempt, 10s timeout, no retry, no cache, no throttle. `lat`/`lon` arrive as strings.
- The request URL contains the token, so it is **never logged or shown**. No LocationIQ attribution (personal, non-commercial use).
- Judge a hit by `matchquality.matchlevel`, never `matchcode`. `venue` (a named place) counts as precise as `building`:

| Geocoder outcome | Result |
|---|---|
| `building` or `venue`, point inside the Zone | Match stands |
| `building` or `venue`, point outside the Zone | **Zone veto**: *no match*. Logged with the address and the point; nothing is sent |
| `street` | Match stands, with note `street only` |
| 404, or any coarser level (`city`, `neighbourhood`, …) | Match stands, with note `not found` |
| any other error (timeout, 5xx, 429, 401, a response body we can't read) | Match stands, with note `<label>`, using the Evaluator's `<label>: <message>` rule, never the URL |

- The veto can only take a Match away, never grant one. A street-only address never triggers it.
- Point-in-polygon: `@turf/boolean-point-in-polygon` against each feature of the Zone.

### [6] Notifier

Sends one text message to `me` per Post that needs one. Text only; the original Post is never forwarded. The whole message is cut to 4096 characters.

| Verdict | Message |
|---|---|
| Match | `<link>\n<reason>` |
| Match, Zone not checked | `<link>\n<reason>\n⚠️ zone not checked: <note>` |
| Evaluation failure | `<link>\n⚠️ couldn't evaluate: <label>: <message>` |
| No match (including a Zone veto) | nothing |

- **If a send fails at runtime,** an error is logged with the Post link, the Post is still marked processed, and the bot keeps running. A Match lost this way survives only in the logs. ([Liveness signal](issues/10-liveness-signal.md))

### Startup

In this order. Any failure crashes the process with a message naming the cause.

1. Read the settings. `API_ID`, `API_HASH`, `CHANNEL_IDS`, `AI_GATEWAY_API_KEY` and `LOCATIONIQ_TOKEN` are required.
2. Check that the Criteria file exists and can be read, and that the Zone file exists and is valid GeoJSON with at least one Polygon or MultiPolygon.
3. Open `data/bot.sqlite` and create the table if it's missing.
4. Connect with the saved session. **The daemon never prompts:** if there's no valid session, it crashes with "run login first". Under `restart: unless-stopped` this loops; accepted.
5. Compare `CHANNEL_IDS` with `joinedChannelIds()`. Log a warning for each ID that isn't joined.
6. Send the startup message to `me`. If this send fails, crash.
   ```
   🟢 started, watching 14/15 channels
   not joined: -1001234567890
   ```
   The second line (IDs separated by commas) appears only when some are missing. Restart loops are not suppressed; repeated 🟢 messages are the alarm. Nothing is sent after a wake from sleep, because the process doesn't restart.
7. Start the Post stream.

There is no heartbeat.

### Logging

- Startup: one line with the channels found and missing.
- Per Post: one line with its link, the Verdict and the reason or error. It also shows the Zone outcome when there was one (the address and point on a veto, or the note).
- Per evaluation: token usage and latency.
- Skipped photos, dropped empty Posts and failed sends are logged with the Post link.
- Never logged: the LocationIQ URL, API keys, the session.

## Commands

One entrypoint, `tsx src/main.ts`:

| Command | What it does |
|---|---|
| (none) | runs the bot |
| `login` | mtcute's interactive `start()`: phone, code, 2FA password in the TTY. Creates `data/session.sqlite`. |
| `resolve-channels <input>...` | read-only; prints `id  title  @username` for each input given. Accepts `@username`, `t.me/<name>` / `https://t.me/<name>` (stripped by us before `resolvePeer`), `t.me/c/<id>/…`, or the title of a joined channel (matched with `iterDialogs({ archived: 'keep' })`). Invite links (`t.me/+…`) are rejected. Never joins. Calls mtcute directly, not through the `Telegram` interface. |

Both are run as `docker compose run --rm userbot <command>` (a TTY and stdin by default). **Stop the daemon first** (`docker compose stop userbot`, run the command, `docker compose up -d`), so two processes never use the session at once. The README says so; nothing enforces it.

## Configuration

`.env` (a committed `.env.example` lists every key, with the defaults commented out):

| Var | Required | Default | Meaning |
|---|---|---|---|
| `API_ID`, `API_HASH` | yes | — | from my.telegram.org |
| `CHANNEL_IDS` | yes | — | comma-separated marked channel IDs (`-100…`), as printed by `resolve-channels` |
| `AI_GATEWAY_API_KEY` | yes | — | Vercel AI Gateway key; the `ai` SDK reads it from the environment |
| `MODEL_ID` | no | `google/gemini-3.8-flash` | gateway model ID |
| `LOCATIONIQ_TOKEN` | yes | — | LocationIQ key |
| `GEOCODER_URL` | no | `https://eu1.locationiq.com/v1/search` | so the provider can be swapped |
| `CRITERIA_PATH` | no | `data/criteria.md` | relative to `/app` |
| `ZONE_PATH` | no | `data/zone.geojson` | relative to `/app` |

Fixed paths with no setting: `data/session.sqlite`, `data/bot.sqlite`.

Constants in code: 3 attempts, 2s/4s backoff, 60s model timeout, 10s geocoder timeout, 1000ms grouping interval, 6 photos, 4096-character message cap, ~200-character error message.

## Starting files

- `data.example/criteria.md`: the starting Criteria below.
- `data.example/zone.geojson`: the OSM Old Batumi + Rustaveli outlines, which the owner can adjust in geojson.io.
- The README says to run `cp -r data.example data` once. There is no seeding code. A missing file crashes startup (see Startup).

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

([Docker and compose layout](issues/09-docker-layout.md))

- **Dockerfile:** `FROM node:26.9.0-trixie-slim` → `npm i -g pnpm@12.4.2` → copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`allowBuilds: { better-sqlite3: false, esbuild: false }`; the binaries are prebuilt) → `pnpm install --frozen-lockfile --prod` → smoke check `RUN node -e "require('better-sqlite3')"` → `COPY src` → `USER node` → `ENTRYPOINT ["tsx", "src/main.ts"]`.
- **Compose:** one service `userbot`: `build: .`, `restart: unless-stopped`, `init: true`, `env_file: .env`, bind mount `./data:/app/data` (so the owner edits the Criteria and Zone from the laptop).
- Runs on the owner's laptop only. The process is down while the laptop sleeps or is off, and **Posts published in those gaps are not recovered**.
- `.gitignore`: `.env`, `data/`, `node_modules/`, `.claude/worktrees/`. `.dockerignore`: `.env`, `data`, `node_modules`, `.git`, `.scratch`, `.claude`, `.agents`, `docs`.
- Secrets live only in `.env`. The session file grants full account access.
- Cost: about $0.01 per 6-photo Post on the model. Google's list price doubles on 2027-01-01.

## Testing

Tests exist so agents can check their own work. Final acceptance is manual.

- **Unit (vitest):** Channel Filter, Post key, Dedupe Store (`:memory:`), message formats and the 4096 cap, error label/message formatting, retry policy, `matchlevel` → Zone outcome, point-in-polygon against the starting Zone (known inside/outside points, e.g. Chavchavadze 50 inside Rustaveli), `resolve-channels` input parsing, settings validation.
- **Integration:** the real pipeline (filter, dedupe, queue, Evaluator, Zone Check, Notifier) against a fake `Telegram`, msw and in-memory SQLite. The restart case reuses one DB handle across two pipeline instances.
- **msw, AI Gateway** (`POST https://ai-gateway.vercel.sh/v4/ai/language-model`, one per call; fixtures follow the SDK's internal format and are tied to `ai@7.0.107`; tests set `AI_GATEWAY_API_KEY` to any value): match, no match, schema-invalid output, persistent 500, one 500 then success, timeout. All carry `address`.
- **msw, LocationIQ** (shapes from the live responses in the research): building inside, building outside, street, city fallback, 404, 401, timeout.

## Out of scope for v0

Backfill of channel history · recovery of Posts published while the bot is down · listing-level dedupe (cross-posts of the same flat) · per-criterion rating cards · a separate Bot API bot for push notifications · handling edits and deletes · automatic channel joining · a heartbeat · hosting anywhere but the owner's laptop · multiple Criteria files or profiles · prompt tuning against sample Posts · geocoder caching or attribution.

## Done when

**Auto** = covered by the automated tests. **Manual** = checked in the acceptance run, in a private test channel the owner creates and adds to `CHANNEL_IDS`.

| # | Check | How |
|---|---|---|
| 1 | The image builds, including the better-sqlite3 smoke check | Manual |
| 2 | First `login` succeeds and creates `data/session.sqlite` on the bind mount (uid 1000 can write; if not, drop `USER node`) | Manual |
| 3 | The daemon starts without prompting, reuses the session, and sends `🟢 started, watching N/M channels` | Manual; message format Auto |
| 4 | An unjoined ID in `CHANNEL_IDS` shows as `not joined: …` in the 🟢 message and the logs | Auto; Manual once |
| 5 | Without a session, the daemon crashes with "run login first" | Manual |
| 6 | A missing Criteria or Zone file, or a missing required setting, crashes startup naming it | Auto |
| 7 | `resolve-channels` prints the ID of the test channel from `@name`, a `t.me` link and its title | Manual; parsing Auto |
| 8 | A new text-only Post in a Watched channel is evaluated | Auto; Manual |
| 9 | A new album is evaluated once, with its photos | Auto; Manual |
| 10 | A Post in an unwatched chat is ignored | Auto |
| 11 | A Match produces exactly one Saved Messages entry with a working link and the reason | Auto; the link Manual |
| 12 | A Match whose address is a building outside the Zone sends nothing; street-only, not-found and geocoder errors add the `⚠️ zone not checked` line | Auto |
| 13 | A model that keeps failing produces one `⚠️ couldn't evaluate` entry after 3 attempts | Auto |
| 14 | Restarting never re-evaluates a Processed Post | Auto; Manual once |
| 15 | A failed runtime send is logged with the link and the bot keeps running | Auto |
| 16 | The logs show one line per Post with link, Verdict and reason; token usage and latency look sane on real Posts | Manual |
