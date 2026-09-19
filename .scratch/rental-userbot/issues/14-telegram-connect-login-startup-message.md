# 14: Telegram connect, login, 🟢 startup message and Docker

**What to build:** the owner can build the image, run `login` once, start the daemon, and see `🟢 started, watching N/M channels` in Saved Messages. The Telegram Adapter exists with `sendToMe` and `joinedChannelIds`; the Post stream is not wired yet. See [spec](../spec.md) § [1] Telegram Adapter, § Startup steps 4–6, § Commands, § Deployment.

**Blocked by:** 13 (Scaffold, settings and startup checks)

**Status:** ready-for-agent

- [ ] The in-house `Telegram` interface from the spec is defined; the adapter is the only pipeline code importing mtcute
- [ ] Client uses `storage: 'data/session.sqlite'`, `updates: { catchUp: false, messageGroupingInterval: 1000 }`
- [ ] `login` command runs mtcute's interactive `start()` and creates the session file
- [ ] The daemon never prompts: with no valid session it crashes with "run login first"
- [ ] `joinedChannelIds` uses `iterDialogs({ archived: 'keep' })` and returns marked IDs
- [ ] Each `CHANNEL_IDS` entry not joined is logged as a warning; one startup log line lists channels found and missing
- [ ] Startup message format: `🟢 started, watching N/M channels`, plus `not joined: <ids comma-separated>` only when some are missing (unit tested against a fake `Telegram`, including the not-joined case)
- [ ] `sendToMe` is `sendText('me', text, { disableWebPreview: true })`; a failed startup send crashes the process
- [ ] Dockerfile and compose file exactly as in § Deployment, including the better-sqlite3 smoke check, `USER node`, `init: true`, bind mount `./data:/app/data`; `.dockerignore` per spec
- [ ] README covers `cp -r data.example data`, `login`, and "stop the daemon before running `login`"
- [ ] Manual: image builds, `login` creates `data/session.sqlite` on the bind mount, daemon sends 🟢 (Done-when 1–5)
