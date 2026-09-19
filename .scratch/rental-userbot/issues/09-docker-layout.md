# Docker and compose layout

Type: grilling
Status: open
Blocked by: 05

## Question

Given [Runtime and Docker facts](04-runtime-and-docker-facts.md) and the dedupe storage choice from [Telegram boundary and Post shape](05-telegram-boundary.md), what exactly is the container layout?

- The data volume: a named Docker volume or a `./data` bind mount. A bind mount lets the owner edit Criteria from the laptop.
- File paths inside it: mtcute session, dedupe DB (if separate), Criteria. What `CRITERIA_PATH` defaults to.
- The `docker compose run --rm` commands to document for first-run login and `resolve-channels`, and the "stop the service first" rule for login.
- The smoke check in the image build (`require('better-sqlite3')`) and the Dockerfile shape (install with `allowBuilds: false`, tsx at runtime).
- What goes in `.gitignore` and `.dockerignore` (`.env`, data directory, session file).
