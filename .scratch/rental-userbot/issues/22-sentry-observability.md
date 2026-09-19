# 22: Sentry AI monitoring and error reporting

**What to build:** with `SENTRY_DSN` set, every agent run shows up in Sentry as a trace (steps, reasoning, tool calls, tokens, cost) and failures show up as errors. With it unset, nothing changes. See [spec](../spec.md) § Logging and Sentry, [Agentic Evaluator](20-agentic-evaluator.md).

**Blocked by:** 19 (Geocode and inZone tools)

**Status:** ready-for-agent

- [ ] `@sentry/node` pinned exactly; wired up with the `sentry-instrument` skill (AI monitoring for the Vercel AI SDK)
- [ ] New setting `SENTRY_DSN`, optional. Sentry starts at startup step 1 only when it is set; with it unset the bot and the tests run fully offline (unit tested)
- [ ] Agent runs appear as traces with their steps, reasoning summaries, tool calls and results, token usage and cost
- [ ] Crashes, evaluation failures and failed sends are reported as errors, with the Post link as context
- [ ] Sentry is never awaited in the pipeline; a Sentry failure or an offline laptop never crashes a run or blocks a Post (checked with an unreachable DSN)
- [ ] API keys, the session and the LocationIQ URL never reach Sentry
- [ ] Console logging stays exactly as it is, so `docker compose logs` works without Sentry
- [ ] Manual: a real Post produces a readable trace in the Sentry project; unset the DSN and the bot behaves as before (Done-when 16)
