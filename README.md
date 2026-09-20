# Rental Listings Userbot

A Telegram userbot, logged in to your own account, that watches apartment rental channels, judges every new
post against a criteria file you write in plain language, and saves the ones worth a look to your Saved
Messages.

The judging is done by an AI agent. It reads the post, looks at the photos, and can call two tools to work
out where the flat is: a geocoder and a check against an outline of the area you want to live in. The agent
makes the final call on its own; no rule in the code overrides it.

## What it does with a post

1. A new post appears in one of the channels listed in `data/channels.txt`. Anything from elsewhere is ignored.
2. Posts already handled are skipped, even after a restart. An album counts as one post.
3. The agent evaluates it against your criteria, one post at a time.
4. A match arrives in Saved Messages as a link plus the agent's notes. Non-matches are silent.
5. If the model fails three times, you get `⚠️ couldn't evaluate` instead, so nothing disappears quietly.

## Requirements

- Docker Desktop.
- A Telegram account, with `API_ID` and `API_HASH` from [my.telegram.org](https://my.telegram.org).
- A [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key, with some credit on it. Roughly $0.02–0.05
  per post with photos. You do **not** need to host anything on Vercel.
- A [LocationIQ](https://locationiq.com) token, free tier.
- Optionally, a [Sentry](https://sentry.io) DSN, to watch the agent work: every run shows up as a trace with
  its steps, tool calls and token cost.

## Setup

```sh
cp .env.example .env
cp -r data.example data
```

Fill in `.env` (see [Environment variables](#environment-variables)), then edit the files in `data/`:

| File | What it is |
|---|---|
| `data/channels.txt` | The channels to watch, one ID per line. See [Listing your channels](#listing-your-channels). |
| `data/criteria.md` | What you want in a flat, in plain language. The agent reads it before every post. |
| `data/prompt.md` | How the agent works: look at photos, read the text, use the tools, decide. |
| `data/zone.geojson` | The area you'll live in. Ships with the Old Batumi and Rustaveli outlines from OpenStreetMap; edit it at [geojson.io](https://geojson.io). |

Edits to these take effect on the next post. No restart needed.

## Running it

Build the image and log in to Telegram once. The login asks for your phone number, the code Telegram sends
you, and your two-factor password if you have one:

```sh
docker compose build
docker compose run --rm userbot login
```

Then start it:

```sh
docker compose up -d
```

**Nothing restarts the bot by itself.** If it crashes, or the laptop reboots, it stays down until you run `docker compose up -d` again. That's deliberate: an automatic restart would turn a bad config or a rate limit into a loop of reconnections, which is the surest way to get an account limited. The 🟢 message not arriving is your signal.

It sends `🟢 started, watching N/M channels` to Saved Messages, so you know it's alive. If any channel you
listed isn't one your account has joined, that message says so.

Watch what it's doing:

```sh
docker compose logs -f userbot
```

Each post reads as a short story, and every line starts with its link, so `docker compose logs userbot | grep <link>` gives you one flat from start to finish:

```
post https://t.me/x/12: considering — channel -1001234567890, 4 photos, "1+1 на Абусеридзе, 5 этаж, 650$…"
post https://t.me/x/12: thinking — The photos show a renovated 1+1; the text gives DS Mall as the building.
post https://t.me/x/12: geocode "DS Mall" → place "DS Mall, 5a, Tbel Abuseridze Street, Bagrationi II" (41.6400, 41.6220) in 214ms
post https://t.me/x/12: inZone (41.6400, 41.6220) → outside
post https://t.me/x/12: done in 6.4s, 2 steps, 4611 tokens in / 567 out (372 thinking)
post https://t.me/x/12: No match — Located at DS Mall, outside Old Town and Rustaveli.
```

**Always stop the daemon before logging in again,** so that two processes never share the Telegram session. The bot also enforces this with a lock file, and the second one to start refuses to run:

```sh
docker compose stop userbot
docker compose run --rm userbot login
docker compose up -d
```

## Listing your channels

`data/channels.txt` holds one channel ID per line. The IDs are the long numeric ones, like
`-1001234567890`: open the channel in [Telegram Web A](https://web.telegram.org/a) and read the number in
the address bar. Whatever you use, the ID must start with `-100`.

```
# Batumi
-1001234567890  # Batumi rentals
-1009876543210  # the noisy one

# -1005555555555  parked for now
```

Anything after a `#` is a comment, blank lines are fine, and any line that isn't a marked channel ID is
ignored — so a bad paste costs you nothing, and neither does an empty file, which simply watches nothing.

Adding or removing a channel takes effect on the next post; nothing needs restarting. When the set of
watched channels changes, the log says so:

```
watchlist: watching 2 channels; added -1009876543210; removed -1001234567890
```

Your account has to have joined every channel it watches; the bot never joins anything by itself. The
membership check runs once, at startup, so a channel added while the bot is running is watched right away
but isn't checked against your joined channels until the next restart — if you never joined it, it's just
quiet.

## Environment variables

Everything lives in `.env`, which is never committed. The session file and the databases hold full access to
your account, so keep `data/` off any shared disk.

**Required:**

| Variable | What it is |
|---|---|
| `API_ID` | Telegram app ID, a number, from [my.telegram.org](https://my.telegram.org) |
| `API_HASH` | Telegram app hash from the same page |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key |
| `LOCATIONIQ_TOKEN` | LocationIQ token, used by the agent's geocoder tool |

**Optional** (leave blank to use the default):

| Variable | Default | What it is |
|---|---|---|
| `MODEL_ID` | `google/gemini-3.8-flash` | Which model the agent runs on. It has to accept images. |
| `GEOCODER_URL` | `https://eu1.locationiq.com/v1/search` | Where the geocoder tool searches |
| `CHANNELS_PATH` | `data/channels.txt` | The channels to watch, one ID per line |
| `CRITERIA_PATH` | `data/criteria.md` | Your criteria file |
| `PROMPT_PATH` | `data/prompt.md` | The agent's instructions |
| `ZONE_PATH` | `data/zone.geojson` | The area outline |
| `SENTRY_DSN` | not set | Set it to send traces and errors to Sentry. Unset, Sentry stays off entirely. |

Startup fails immediately, naming what's wrong, if a required variable is missing or a file listed above
can't be read.

## Keeping your account safe

Telegram doesn't love automation on personal accounts, so the bot behaves like a quiet client:

- It writes **only to your own Saved Messages**, never to anyone else, so there's nothing for anyone to report.
- It **never joins, leaves or opens channels**. You join them yourself.
- It **waits out rate limits** (up to five minutes) instead of retrying into them, and nothing restarts it into one.
- Only **one process at a time** can use the session, so it's never revoked for being used twice.

What's up to you: run it on an established account rather than a fresh one, keep it on your normal home connection rather than a datacenter VPN, and stay logged in on your phone or desktop client too.

## Good to know

- **It only sees posts published while it's running.** When the laptop sleeps or the container is down,
  those posts are gone; there's no catch-up.
- **It only ever writes to your own Saved Messages.** It never posts, replies, joins or leaves anything.
- **The same flat posted in two channels arrives twice.** Matching across channels isn't in this version.
- With Sentry on, your criteria and the post text are sent there as part of each trace.

## Development

```sh
pnpm install
pnpm test        # vitest, no network needed
pnpm typecheck
```

Tests run fully offline: the model is a scripted mock, the geocoder is mocked HTTP, and the database is
in-memory. They cover the plumbing; whether the agent judges flats well is checked by hand.

The design lives in `.scratch/rental-userbot/`: `spec.md` is what was built, `map.md` indexes the decisions
behind it, and `CONTEXT.md` at the repo root defines the vocabulary.
