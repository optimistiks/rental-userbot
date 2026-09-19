# 13: Scaffold, settings and startup checks (no Telegram)

**What to build:** the project foundation every later ticket builds on, runnable locally without touching Telegram. `tsx src/main.ts` reads and validates the settings, checks the Criteria file, opens the Dedupe Store database (creating the table), and crashes with a message naming the cause when any of that fails. See [spec](../spec.md) § Stack, § Startup steps 1–3, § Configuration, § Starting files.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] pnpm project with every dependency pinned to an exact version (no `^`/`~`); `tsx` is a runtime dependency, vitest + msw are dev dependencies; no build step. The registry does not publish `better-sqlite3@12.12.0`, so the compatible published `12.11.1` is used instead.
- [x] `pnpm-workspace.yaml` with `allowBuilds: { better-sqlite3: true, esbuild: false }`; `node -e "require('better-sqlite3')"` works locally
- [x] `pnpm test` runs vitest; `pnpm typecheck` passes
- [x] Settings are read from the environment: `API_ID`, `API_HASH`, `CHANNEL_IDS`, `AI_GATEWAY_API_KEY`, `LOCATIONIQ_TOKEN` required; `MODEL_ID`, `GEOCODER_URL`, `CRITERIA_PATH`, `ZONE_PATH` default as in § Configuration; `CHANNEL_IDS` parsed as comma-separated marked IDs (`-100…`)
- [x] A missing or malformed required setting crashes startup naming the variable (unit tested)
- [x] A missing or unreadable Criteria file crashes startup naming it (unit tested)
- [x] `data/bot.sqlite` is opened with better-sqlite3 and `processed_posts` is created if missing (schema from § Dedupe Store); tests can pass `:memory:`
- [x] Constants from § Configuration live in one place in code
- [x] `.env.example` lists every key, defaults commented out
- [x] `data.example/criteria.md` holds the starting Criteria from the spec
- [x] `.gitignore` per § Deployment
- [x] Logging is plain `console`

## Comments

- 2026-09-20: `better-sqlite3@12.12.0` from the locked spec is not published in the configured npm registry. `12.11.1` is the latest available 12.x release and satisfies mtcute's `^12.10.0` dependency range; the frozen install and native smoke check pass with it.
- 2026-09-20: the [Agentic Evaluator](20-agentic-evaluator.md) redesign adds two settings this ticket didn't have, `PROMPT_PATH` and `SENTRY_DSN`, plus `data.example/prompt.md` and its startup check. They are picked up by ticket 15 (prompt file) and ticket 22 (Sentry), not by reopening this one.
