# Docker and compose layout

Type: grilling
Status: open
Blocked by: 05, 12

## Question

Given [Runtime and Docker facts](04-runtime-and-docker-facts.md) and the dedupe storage choice from [Telegram boundary and Post shape](05-telegram-boundary.md), what exactly is the container layout?

- The data volume: a named Docker volume or a `./data` bind mount. A bind mount lets the owner edit Criteria from the laptop.
- File paths inside it: mtcute session, dedupe DB (`bot.sqlite`, a separate file, decided in Telegram boundary and Post shape), Criteria, and the Zone file (`zone.geojson`, decided in [Judging the district from a Post's address](12-district-judgement.md)). What `CRITERIA_PATH` defaults to (`ZONE_PATH` defaults to `data/zone.geojson`), and how the committed starting copy of `zone.geojson` gets onto the volume.
- The `docker compose run --rm` commands to document for first-run login and `resolve-channels`, and the "stop the service first" rule for login.
- The smoke check in the image build (`require('better-sqlite3')`) and the Dockerfile shape (install with `allowBuilds: false`, tsx at runtime).
- What goes in `.gitignore` and `.dockerignore` (`.env`, data directory, session file).
