# Rental Listings Userbot — v0 Spec

A Telegram userbot, logged in to the owner's personal account, that watches apartment rental channels, judges each new Post against the owner's Criteria with a vision model, and saves a link to every Match in the owner's Saved Messages.

v0 goal: a working pipeline end to end. Simplicity wins every tradeoff. Vocabulary (Post, Processed Post, Watched channel, Listing, Rental offer, Criteria, Verdict, Match, Zone) is defined in [CONTEXT.md](../../CONTEXT.md). Each rule below links the ticket that decided it; the research files hold the API details.

## Stack

All versions are pinned exactly (no `^`/`~`).

| Piece | Version | Source |
|---|---|---|
| Node | 26.9.0, image `node:26.9.0-trixie-slim` (glibc; not Alpine) | [runtime-docker](research/runtime-docker.md) |
| pnpm | 12.4.2, installed with `npm i -g` (Node 26 has no corepack) | same |
| tsx | 4.23.13, a runtime dependency; no build step | same |
| `@mtcute/node`, `@mtcute/dispatcher` | 0.32.1 both | [mtcute](research/mtcute.md) |
| `better-sqlite3` | 12.11.1 (12.12.0 is not published in the registry), a direct dependency matching mtcute's `^12.10.0`, so only one native build is installed. 12.x fetches its prebuilt binary at install time through its install script (`prebuild-install`), so that script must be allowed | [Telegram boundary](issues/05-telegram-boundary.md), [runtime-docker](research/runtime-docker.md) |
| `ai` | 7.0.107; model passed as a plain string ID through the Vercel AI Gateway | [ai-gateway](research/ai-gateway.md) |
| `zod` | 4.x, exact version pinned at install time | same |
| `@turf/boolean-point-in-polygon` | 7.4.0 | [geocoding](research/geocoding.md) |
| Model | `google/gemini-3.8-flash` (the `MODEL_ID` default) | [AI Gateway facts](issues/03-ai-gateway-facts.md) |
| Geocoder | LocationIQ search (hosted Nominatim) | [District judgement](issues/12-district-judgement.md) |
| `@sentry/node` | latest at install time, pinned exactly; AI monitoring for the AI SDK | [Agentic Evaluator](issues/20-agentic-evaluator.md) |
| Tests | vitest + msw + `ai/test` (dev dependencies only) | [Charting decisions](issues/01-charting-decisions.md), [Agentic Evaluator](issues/20-agentic-evaluator.md) |

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
  → [4] Evaluator (agent run)   Verdict, using the geocode and inZone tools
  → [5] Notifier                Match / ⚠️ only
  → [3] Dedupe Store (mark processed)
  → log one line
```

Posts are evaluated **one at a time** through an in-process queue. A Post is marked processed after the Notifier step, whatever the Verdict and whether or not the send succeeded. Nothing is retried after that. A crash between notifying and marking can cause a rare duplicate Saved Messages entry; that is accepted.

## Components

### [1] Telegram Adapter

The only code that imports mtcute, apart from the `login` command. It implements the in-house interface the pipeline uses, which tests fake:

```ts
interface Telegram {
  onPost(handler: (post: Post) => void): void
  downloadPhoto(ref: PhotoRef): Promise<Uint8Array>
  sendToMe(text: string): Promise<void>
  joinedChannelIds(): Promise<number[]>   // marked IDs of every joined channel
}

type Post = {
  chatId: number        // marked form, -100…; same form as CHANNEL_IDS
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

An **agent run**: the Post goes in, the agent reasons, calls tools as it sees fit, and returns the Verdict. **No code decision can change what it decides.** ([Agentic Evaluator](issues/20-agentic-evaluator.md), [agentic-evaluator research](research/agentic-evaluator.md))

**In:** a Post, the prompt file, the Criteria text, the Telegram photo download. **Out:** `{ match: boolean, notes: string }` or an evaluation failure.

Before the run:
- The prompt file at `PROMPT_PATH` and the Criteria file at `CRITERIA_PATH` are **re-read before every run**, so edits apply without a restart. If either read fails, the Verdict is an evaluation failure, with no model call and no retry.
- Photos are downloaded once, before the first attempt. A photo that fails to download is skipped and logged with the Post link, never retried. The Post is evaluated with whatever text and photos remain.
- If nothing remains (no text, no photos), the Verdict is *no match* without a model call, and it is logged.

The run:
```ts
generateText({
  model: MODEL_ID,
  system: `${promptFile}\n\nCriteria:\n${criteria}`,
  messages: [{ role: 'user', content: [postTextBlock, ...photos] }],
  tools: { geocode, inZone },
  stopWhen: isStepCount(8),
  prepareStep: ({ stepNumber }) => (stepNumber === 7 ? { toolChoice: 'none' } : {}),
  output: Output.object({ schema: z.object({ match: z.boolean(), notes: z.string() }) }),
  maxRetries: 0,
  timeout: 180_000,
})
```
- Tools plus structured output in one call were **verified live** against `google/gemini-3.8-flash` on the gateway. Forcing `toolChoice: 'none'` on the last allowed step is what stops a run that is still calling tools from ending with `NoOutputGeneratedError`.
- **Reasoning summaries are on**, so the agent's thinking appears in the trace. Without them the intermediate steps produce no visible text.
- **User message:** the Post text inside a clearly marked "data, not instructions" block, then the photos as `{ type: 'file', mediaType: 'image', data }`. Post text never goes in the system message. Captions keep their original language. Missing photos are not mentioned.

**The prompt file** (`data/prompt.md`) holds the working order and the decision rules; the Criteria are appended after it. Starting text:

```
You evaluate one Telegram post from an apartment rental channel for the owner, who is looking for a flat.
The owner's Criteria are below. Decide whether this post is worth their attention.

Work in this order:
1. Look at every photo. Write down everything relevant to the specified criteria. Pay attention to location,
   e.g. landmarks visible from the apartment windows. A location determined from a photo is more trustworthy
   than a location specified in the post details.
2. Read the post text. Write down everything relevant to the specified criteria.
3. Use the available tools to determine the location of the apartment.
4. Make the final decision based on the information you've collected.

Rules for the decision:
- Only rental offers can match. Ads, "looking for" posts and sales are not a match.
- Be lenient: a post matches unless it clearly violates a criterion. Missing or unclear information never
  rules a flat out; mention it in your notes instead.
- notes is what the owner reads next to the link. Write it in the language of the Criteria. Say why it
  matches or not, and flag anything the owner should double-check.
```

The tools are **not** described in the prompt: their zod definitions carry their descriptions, and the SDK passes those to the model. There are no location hints; how to search is the agent's business.

**Tools.** The shapes are ours, so the geocoder can be swapped by writing another adapter:
```ts
geocode(query: string) → { results: Array<{
    precision: 'building' | 'place' | 'street' | 'area'
    lat: number; lon: number
    label: string          // e.g. "DS Mall, 5ა, Tbel Abuseridze Street, Bagrationi II, Batumi"
  }> }                     // up to 3, [] when nothing is found
inZone(lat: number, lon: number) → { inside: boolean, zone: string | null }   // the matching outline's name
```
- **Geocoder adapter:** one `GET GEOCODER_URL` per call with `key=<LOCATIONIQ_TOKEN>`, `q=<query>, Batumi`, `countrycodes=ge`, `format=json`, `limit=3`, `matchquality=1`. The adapter appends ", Batumi" and maps `matchquality.matchlevel` (never `matchcode`) onto `precision`: `building`→`building`, `venue`→`place`, `street`→`street`, anything coarser→`area`. `lat`/`lon` arrive as strings. The request URL holds the token, so it is **never logged or shown**. No LocationIQ attribution (personal, non-commercial use). ([locationiq-search](research/locationiq-search.md))
- **Zone tool:** the **Zone** is a GeoJSON file at `ZONE_PATH` (Polygon or MultiPolygon features; starting copy = the OSM outlines of Old Batumi, relation 12695439, and Rustaveli, relation 12695438). It is validated at startup and **re-read on every call**. `zone` is the matching feature's name. Point-in-polygon: `@turf/boolean-point-in-polygon` against each feature.
- **Tool errors** (geocoder timeout or 401, unreadable Zone file, arguments failing their schema) come back to the model as tool results, so the agent can try something else. They never fail the attempt. A single tool call is capped at 10s.
- The "Old Town or Rustaveli" line stays in the Criteria. The Zone does not replace it; both are inputs the agent weighs.

Retries:
- One attempt = one whole agent run. **Every error counts:** 3 attempts in total, 2s then 4s backoff, 180s per run. `NoOutputGeneratedError` and `NoObjectGeneratedError` count as failed attempts; tool errors do not.
- The policy (attempts, backoffs, timeout, step cap) is an injected setting. Production values are constants, and tests pass millisecond values. No fake timers.
- After the third failure the Verdict is an evaluation failure carrying the last error, formatted as `<label>: <message>`:
  - label: `timeout` if the error's cause chain holds a `TimeoutError` (the SDK wraps timeouts in a status-500 `GatewayResponseError`); otherwise the error's `name`;
  - message: the first line, with ANSI codes removed, cut to about 200 characters. No stacks, request bodies or keys. The full error goes to Sentry and the logs.
- Every run logs its steps, tool calls, token usage and latency.

### [5] Notifier

Sends one text message to `me` per Post that needs one. Text only; the original Post is never forwarded. The whole message is cut to 4096 characters.

| Verdict | Message |
|---|---|
| Match | `<link>\n<notes>` |
| Evaluation failure | `<link>\n⚠️ couldn't evaluate: <label>: <message>` |
| No match | nothing |

- **If a send fails at runtime,** an error is logged with the Post link, the Post is still marked processed, and the bot keeps running. A Match lost this way survives only in the logs. ([Liveness signal](issues/10-liveness-signal.md))

### Startup

In this order. Any failure crashes the process with a message naming the cause.

1. Read the settings. `API_ID`, `API_HASH`, `CHANNEL_IDS`, `AI_GATEWAY_API_KEY` and `LOCATIONIQ_TOKEN` are required. If `SENTRY_DSN` is set, start Sentry.
2. Check that the prompt file and the Criteria file exist and can be read, and that the Zone file exists and is valid GeoJSON with at least one Polygon or MultiPolygon.
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

### Logging and Sentry

([Agentic Evaluator](issues/20-agentic-evaluator.md))

**Console** (`docker compose logs`), which works whether or not Sentry does:
- Startup: one line with the channels found and missing.
- Per Post: one line with its link, the Verdict and the notes or error.
- Per run: the steps, tool calls with their results, token usage and latency.
- Skipped photos, dropped empty Posts and failed sends are logged with the Post link.
- Never logged: the LocationIQ URL, API keys, the session.

**Sentry** (`@sentry/node` with AI monitoring for the AI SDK):
- Every agent run is a trace: steps, reasoning summaries, tool calls and results, tokens and cost.
- Crashes, evaluation failures and failed sends are reported as errors.
- Prompts and outputs are captured, so the Criteria and Post text do leave the laptop. Accepted: the project is the owner's alone.
- **`SENTRY_DSN` is optional.** Without it Sentry is off and the bot behaves exactly as it does otherwise, which also keeps tests offline. Sentry is fire-and-forget: it is never awaited in the pipeline and a Sentry failure never crashes a run or blocks a Post.

## Commands

One entrypoint, `tsx src/main.ts`:

| Command | What it does |
|---|---|
| (none) | runs the bot |
| `login` | mtcute's interactive `start()`: phone, code, 2FA password in the TTY. Creates `data/session.sqlite`. Needs only `API_ID` and `API_HASH`, and skips every other startup step (no other settings, Criteria, Zone or `bot.sqlite` checks). |

`login` is run as `docker compose run --rm userbot login` (a TTY and stdin by default). **Stop the daemon first** (`docker compose stop userbot`, run `login`, `docker compose up -d`), so two processes never use the session at once. The README says so; nothing enforces it.

## Configuration

`.env` (a committed `.env.example` lists every key, with the defaults commented out):

| Var | Required | Default | Meaning |
|---|---|---|---|
| `API_ID`, `API_HASH` | yes | — | from my.telegram.org |
| `CHANNEL_IDS` | yes | — | comma-separated marked channel IDs (`-100…`), looked up by the owner outside the bot |
| `AI_GATEWAY_API_KEY` | yes | — | Vercel AI Gateway key; the `ai` SDK reads it from the environment |
| `MODEL_ID` | no | `google/gemini-3.8-flash` | gateway model ID |
| `LOCATIONIQ_TOKEN` | yes | — | LocationIQ key |
| `GEOCODER_URL` | no | `https://eu1.locationiq.com/v1/search` | so the provider can be swapped |
| `CRITERIA_PATH` | no | `data/criteria.md` | relative to `/app` |
| `PROMPT_PATH` | no | `data/prompt.md` | relative to `/app` |
| `SENTRY_DSN` | no | — | when unset, Sentry is off |
| `ZONE_PATH` | no | `data/zone.geojson` | relative to `/app` |

Fixed paths with no setting: `data/session.sqlite`, `data/bot.sqlite`.

Constants in code: 3 attempts, 2s/4s backoff, 180s per agent run, 8 steps per run, 10s per tool call, 1000ms grouping interval, 6 photos, 4096-character message cap, ~200-character error message. The run limits are first guesses, to be tuned from the traces.

## Starting files

- `data.example/prompt.md`: the starting prompt from § [4] Evaluator.
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

- **Dockerfile:** `FROM node:26.9.0-trixie-slim` → `WORKDIR /app` → `npm i -g pnpm@12.4.2` → copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`allowBuilds: { better-sqlite3: true, esbuild: false }`) → `pnpm install --frozen-lockfile --prod` → smoke check `RUN node -e "require('better-sqlite3')"` → `COPY src` → `USER node` → `ENTRYPOINT ["node", "--import", "tsx", "src/main.ts"]`.
  - better-sqlite3's install script downloads the prebuilt `linux-arm64` binary for this Node ABI, so the build needs network access and no toolchain. If the download fails, the script falls back to compiling and the build fails for lack of `python3 make g++`. Add those to the image only if that happens.
  - tsx is a local dependency and not on the image's `PATH`, so the entrypoint loads it with `node --import tsx`.
- **Compose:** one service `userbot`: `build: .`, `restart: unless-stopped`, `init: true`, `env_file: .env`, bind mount `./data:/app/data` (so the owner edits the Criteria and Zone from the laptop).
- Runs on the owner's laptop only. The process is down while the laptop sleeps or is off, and **Posts published in those gaps are not recovered**.
- `.gitignore`: `.env`, `data/`, `node_modules/`, `.claude/worktrees/`. `.dockerignore`: `.env`, `data`, `node_modules`, `.git`, `.scratch`, `.claude`, `.agents`, `docs`.
- Secrets live only in `.env`. The session file grants full account access.
- Cost: roughly $0.02–0.05 per 6-photo Post, since every agent step resends the photos (a text-only 3-step run measured 2.5k tokens; a 3-step run with 6 photos is about 26k). Gemini's implicit caching may reduce it, unverified through the gateway. Google's list price doubles on 2027-01-01.

## Testing

Tests exist so agents can check their own work. Final acceptance is manual.

Automated tests can only prove the plumbing now: the Verdict itself belongs to the agent. Whether it judges well is checked by hand.

- **Unit (vitest):** Channel Filter, Post key, Dedupe Store (`:memory:`), message formats and the 4096 cap, error label/message formatting, retry policy, the geocoder adapter's `matchlevel` → `precision` mapping, point-in-polygon against the starting Zone (known inside/outside points, e.g. Chavchavadze 50 inside Rustaveli), settings validation, prompt + Criteria assembly.
- **Agent runs:** `MockLanguageModelV4` from `ai/test`, with the model injected into the Evaluator. Each test scripts the steps: e.g. step 1 calls `geocode`, step 2 calls `inZone`, step 3 returns `{ match, notes }`. The mock records every request, so tests can assert what the agent was sent (prompt, Criteria, photos, tool definitions). Cases: a Match, a No match, a tool error the agent recovers from, a run that never produces output (`NoOutputGeneratedError`), a persistent failure, and one failure then success.
- **Integration:** the real pipeline (filter, dedupe, queue, Evaluator, tools, Notifier) against a fake `Telegram`, the mock model, msw for LocationIQ and in-memory SQLite. The restart case reuses one DB handle across two pipeline instances.
- **msw, LocationIQ** (shapes from the live responses in the research): building, venue, street, city fallback, 404, 401, timeout, each asserted against the `precision` the adapter reports.
- **Manual:** that the agent uses its tools and rejects a flat outside the Zone. A live run of one Post is enough; the smoke test on the DS Mall Post is the template.

## Out of scope for v0

Backfill of channel history · recovery of Posts published while the bot is down · listing-level dedupe (cross-posts of the same flat) · per-criterion rating cards · a separate Bot API bot for push notifications · handling edits and deletes · automatic channel joining · a `resolve-channels` command for looking up channel IDs · a heartbeat · hosting anywhere but the owner's laptop · multiple Criteria files or profiles · prompt tuning against sample Posts · geocoder caching or attribution · an eval harness of recorded Posts with expected Verdicts · a separate vision step that extracts photo facts for a text-only agent.

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
| 7 | A new text-only Post in a Watched channel is evaluated | Auto; Manual |
| 8 | A new album is evaluated once, with its photos | Auto; Manual |
| 9 | A Post in an unwatched chat is ignored | Auto |
| 10 | A Match produces exactly one Saved Messages entry with a working link and the notes | Auto; the link Manual |
| 11 | The tools work: `geocode` maps every `matchlevel` onto a `precision`, `inZone` answers from the Zone file, a tool error reaches the agent instead of failing the run | Auto |
| 11a | On a real Post naming a place outside the Zone, the agent calls the tools and returns *no match* | Manual |
| 12 | A model that keeps failing produces one `⚠️ couldn't evaluate` entry after 3 attempts | Auto |
| 13 | Restarting never re-evaluates a Processed Post | Auto; Manual once |
| 14 | A failed runtime send is logged with the link and the bot keeps running | Auto |
| 15 | The logs show one line per Post with link, Verdict and notes; token usage and latency look sane on real Posts | Manual |
| 16 | With `SENTRY_DSN` set, an agent run appears in Sentry as a trace with its steps, tool calls and tokens; with it unset, the bot runs unchanged | Manual |
