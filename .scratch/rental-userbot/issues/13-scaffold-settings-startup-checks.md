# 13: Scaffold, settings and startup checks (no Telegram)

**What to build:** the project foundation every later ticket builds on, runnable locally without touching Telegram. `tsx src/main.ts` reads and validates the settings, checks the Criteria file, opens the Dedupe Store database (creating the table), and crashes with a message naming the cause when any of that fails. See [spec](../spec.md) § Stack, § Startup steps 1–3, § Configuration, § Starting files.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] pnpm project with every dependency in § Stack pinned to an exact version (no `^`/`~`); `tsx` is a runtime dependency, vitest + msw are dev dependencies; no build step
- [ ] `pnpm-workspace.yaml` with `allowBuilds: { better-sqlite3: true, esbuild: false }` (better-sqlite3 12.12.0 downloads its prebuilt binary through its install script); `node -e "require('better-sqlite3')"` works locally
- [ ] `pnpm test` runs vitest; `pnpm typecheck` (or equivalent) passes
- [ ] Settings are read from the environment: `API_ID`, `API_HASH`, `CHANNEL_IDS`, `AI_GATEWAY_API_KEY`, `LOCATIONIQ_TOKEN` required; `MODEL_ID`, `GEOCODER_URL`, `CRITERIA_PATH`, `ZONE_PATH` default as in § Configuration; `CHANNEL_IDS` parsed as comma-separated marked IDs (`-100…`)
- [ ] A missing or malformed required setting crashes startup naming the variable (unit tested)
- [ ] A missing or unreadable Criteria file crashes startup naming it (unit tested)
- [ ] `data/bot.sqlite` is opened with better-sqlite3 and `processed_posts` is created if missing (schema from § Dedupe Store); tests can pass `:memory:`
- [ ] Constants from § Configuration live in one place in code
- [ ] `.env.example` lists every key, defaults commented out
- [ ] `data.example/criteria.md` holds the starting Criteria from the spec
- [ ] `.gitignore` per § Deployment
- [ ] Logging is plain `console`
