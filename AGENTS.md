## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Lint and format

`pnpm lint` (oxlint, type-aware) and `pnpm fmt` (oxfmt) — also `pnpm lint:fix` and `pnpm fmt:check`. Nothing runs them automatically; run both before handing work back. `oxlint --fix` can change behaviour, so always follow it with `pnpm test` and `pnpm typecheck`.
