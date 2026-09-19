# Rental Listings Userbot

This userbot watches the configured Telegram rental channels and saves matching
posts to Saved Messages.

## Setup

```sh
cp .env.example .env
cp -r data.example data
```

Fill in `.env`, then build and log in:

```sh
docker compose build
docker compose run --rm userbot login
docker compose up -d
```

Stop the daemon before running `login`, so the login command and daemon never
use the Telegram session at the same time:

```sh
docker compose stop userbot
docker compose run --rm userbot login
docker compose up -d
```
