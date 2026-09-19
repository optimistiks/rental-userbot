# Runtime and Docker facts

Type: research
Status: resolved
Blocked by: —

## Question

What runtime and container setup works for this project today? Cite sources.

1. **Node version.** Which Node release is the latest as of now, and its status (Current vs LTS, and when it becomes LTS). The official Docker image tag to use (slim or alpine, on the owner's Apple Silicon laptop, so `linux/arm64`).
2. **Native SQLite on that Node.** Whether `better-sqlite3` ships prebuilt binaries for that Node ABI on `linux/arm64` (glibc and musl), or whether a toolchain is needed in the image. Also whether `node:sqlite` is stable or unflagged on that version, as an alternative.
3. **`tsx`** works on that Node version. Also whether Node's built-in type stripping makes `tsx` unnecessary for our runtime (keep `tsx` unless there's a clear reason not to).
4. **pnpm in Docker.** The current recommended way to use pnpm in a Node image (corepack status on that Node version, since corepack is being unbundled), and the `pnpm install --frozen-lockfile` + native build pattern.
5. **Interactive one-shot runs.** How `docker compose run --rm <service> <cmd>` gets a TTY and stdin for the login prompt and for `resolve-channels`, and whether `stdin_open`/`tty` settings in compose are needed or matter.

Write findings to `.scratch/rental-userbot/research/runtime-docker.md`.

## Answer

Findings are in [research/runtime-docker.md](../research/runtime-docker.md). The file includes a sketch Dockerfile, compose service and `pnpm-workspace.yaml`. Docker wasn't running, so nothing was tried in a real container.

- **Node:** 26.9.0 (Current; becomes LTS 2026-10-28). Image: `node:26.9.0-trixie-slim` (glibc). Avoid Alpine: its musl arm64 builds aren't tested by Node before release.
- **SQLite:** `better-sqlite3@13.0.3` ships prebuilt linux-arm64 binaries for glibc and musl, so no toolchain is needed. `node:sqlite` needs no flag but is still a release candidate and changing, so it's a fallback only. Caveat: better-sqlite3 13 is a two-month-old rewrite.
- **tsx:** `4.23.13` works on Node 26. Keep it, because built-in type stripping rejects enums and parameter properties. It must be installed in the runtime image.
- **pnpm:** Node 25+ ships without corepack. Install with `npm i -g pnpm@12.4.2`. pnpm 12 fails the install with `ERR_PNPM_IGNORED_BUILDS` for better-sqlite3 and esbuild. Fix: `allowBuilds: { better-sqlite3: false, esbuild: false }` in `pnpm-workspace.yaml`, which was checked locally and works because the binaries are prebuilt.
- **Compose:** `docker compose run --rm` keeps stdin open and gives a TTY by default, so no `stdin_open`/`tty` settings are needed. Run login with the long-running service stopped, so they don't use the same session and database at once.
- **Open:** the arm64 binary loading in a container wasn't actually run. The first image build should include a smoke test: `node -e "require('better-sqlite3')"`.
