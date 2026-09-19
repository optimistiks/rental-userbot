# Docker and compose layout

Type: grilling
Status: resolved
Blocked by: 05, 12

## Question

Given [Runtime and Docker facts](04-runtime-and-docker-facts.md) and the dedupe storage choice from [Telegram boundary and Post shape](05-telegram-boundary.md), what exactly is the container layout?

- The data volume: a named Docker volume or a `./data` bind mount. A bind mount lets the owner edit Criteria from the laptop.
- File paths inside it: mtcute session, dedupe DB (`bot.sqlite`, a separate file, decided in Telegram boundary and Post shape), Criteria, and the Zone file (`zone.geojson`, decided in [Judging the district from a Post's address](12-district-judgement.md)). What `CRITERIA_PATH` defaults to (`ZONE_PATH` defaults to `data/zone.geojson`), and how the committed starting copy of `zone.geojson` gets onto the volume.
- The `docker compose run --rm` commands to document for first-run login and `resolve-channels`, and the "stop the service first" rule for login.
- The smoke check in the image build (`require('better-sqlite3')`) and the Dockerfile shape (install with `allowBuilds: false`, tsx at runtime).
- What goes in `.gitignore` and `.dockerignore` (`.env`, data directory, session file).

## Answer

Decided with the owner (2026-09-20), building on [Runtime and Docker facts](04-runtime-and-docker-facts.md), [Telegram boundary and Post shape](05-telegram-boundary.md) and [Judging the district from a Post's address](12-district-judgement.md).

**Data volume**
- Bind mount `./data:/app/data`, so the owner edits the Criteria and the Zone from the laptop.
- Fixed files: `data/session.sqlite` (mtcute) and `data/bot.sqlite` (dedupe). Neither has a setting.
- `CRITERIA_PATH` defaults to `data/criteria.md`, and `ZONE_PATH` to `data/zone.geojson`. Both are relative to `/app` and only need to be in `.env` to override.

**Starting files**
- The repo commits `data.example/criteria.md` (the spec's starting Criteria) and `data.example/zone.geojson` (the OSM Old Batumi + Rustaveli outlines).
- The README says to run `cp -r data.example data` once. The bot has no seeding code. It crashes at startup, naming the path, if the Criteria or Zone file is missing.

**Commands**
- One entrypoint: `ENTRYPOINT ["tsx", "src/main.ts"]`. No argument runs the bot, `login` runs mtcute's interactive `start()`, and `resolve-channels` prints channel IDs.
- Documented as `docker compose run --rm userbot login` and `docker compose run --rm userbot resolve-channels`.
- The daemon never prompts. If there's no valid session it crashes at startup with "run login first". The restart loop this causes under `restart: unless-stopped` is accepted.
- Before either command, stop the daemon: `docker compose stop userbot`, then run the command, then `docker compose up -d`. This rule is in the README only; nothing enforces it.

**Dockerfile and compose**
- `FROM node:26.9.0-trixie-slim`, then `npm i -g pnpm@12.4.2`.
- Copy `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` (`allowBuilds: false` for better-sqlite3 and esbuild), then `pnpm install --frozen-lockfile --prod`. `tsx` is in `dependencies`, and vitest and msw are in `devDependencies`, so tests never run in the image.
- Smoke check: `RUN node -e "require('better-sqlite3')"`.
- Then `COPY src` and `USER node`.
- Compose: one `userbot` service with `build: .`, `restart: unless-stopped`, `init: true`, `env_file: .env` and the bind mount.
- Unverified: whether uid 1000 can write to the bind mount on Docker Desktop for Mac. This is part of the manual acceptance run (first login creates `data/session.sqlite`). If it fails, drop `USER node`.

**Ignore files**
- `.gitignore`: `.env`, `data/`, `node_modules/` (plus the existing `.claude/worktrees/`).
- `.dockerignore`: `.env`, `data`, `node_modules`, `.git`, `.scratch`, `.claude`, `.agents`, `docs`.
- A committed `.env.example` lists every setting: `API_ID`, `API_HASH`, `CHANNEL_IDS`, `AI_GATEWAY_API_KEY`, `MODEL_ID`, `LOCATIONIQ_TOKEN`, and commented-out defaults for `CRITERIA_PATH`, `ZONE_PATH` and `GEOCODER_URL`.
