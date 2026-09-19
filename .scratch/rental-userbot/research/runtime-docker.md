# Research: runtime and Docker facts (Node, SQLite, tsx, pnpm, Compose)

Checked 2026-09-19 against primary sources. Some claims were also checked by hand on the owner's Mac (Node 26.7.0 via nvm, pnpm 12.4.2 via `npx`); these are marked **[verified locally]**. Docker Desktop was not running, so nothing was checked inside a container.

## Summary / recommendations

- **Node:** use **Node 26** (26.9.0, released 2026-09-16). It is the latest release. It is "Current" now and becomes **Active LTS on 2026-10-28**. Image: **`node:26-slim`** (Debian trixie, glibc). Pin `node:26.9.0-trixie-slim` if you want reproducible builds. Avoid Alpine: Node's musl arm64 builds are untested before release, and the Alpine arm64 image builds Node from source.
- **SQLite:** use **better-sqlite3 13.x** (13.0.3). From v13 it uses N-API and **ships prebuilt `linux-arm64` (glibc) and `linuxmusl-arm64` binaries inside the npm tarball**. It needs no toolchain or download step. The glibc build needs glibc 2.34 or newer, and trixie has that. `node:sqlite` also works: it is unflagged, "Stability 1.2 – Release candidate", and prints no warning. It is a workable fallback but not "Stable".
- **pnpm build-script trap:** pnpm 12 counts better-sqlite3 as having a build script, because the package includes a `binding.gyp`. With the default `strictDepBuilds: true`, an unreviewed build script makes the install fail with `ERR_PNPM_IGNORED_BUILDS`. If you set `allowBuilds: { better-sqlite3: true }`, pnpm runs `node-gyp rebuild`. That rebuild does nothing when a prebuild exists, but it still needs `python3` and `make`, and the slim image has neither. **Recommendation: set `better-sqlite3: false` and `esbuild: false` in `allowBuilds`.** Both packages work without their scripts **[verified locally]**.
- **tsx:** keep **tsx 4.23.x**. It runs on Node 26 **[verified locally]**. Node's built-in type stripping is Stable, but it rejects enums, parameter properties and namespaces. It also needs explicit `.ts` import extensions and ignores `tsconfig` paths. None of these is a blocker, but tsx avoids all of them.
- **pnpm install method:** Corepack is **not shipped with Node 25 or later**, and the `node:26` images contain no corepack. pnpm 12 is a native binary. Simplest option: `RUN npm install -g pnpm@12.4.2` (npm is still bundled). Keep `packageManager: "pnpm@12.4.2"` in package.json.
- **Interactive one-shot commands:** `docker compose run --rm userbot <cmd>` gives the container stdin and a TTY by default when your terminal is a TTY. `stdin_open` and `tty` in the compose file are **not needed** for `run`: `run` overrides them. Leave them off the long-running service.

### Sketch Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
# pin as node:26.9.0-trixie-slim for reproducibility
FROM node:26-slim
ENV NODE_ENV=production
RUN npm install -g pnpm@12.4.2
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# cache target assumes pnpm's default Linux store path for root (check with `pnpm store path`)
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# tsx is needed at runtime (no build step), so it must be a regular dependency or --prod must not be used.

COPY . .
# ensure the data volume is writable by uid 1000
USER node
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
```

`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  better-sqlite3: false   # prebuilt N-API binary ships in the tarball; the implicit node-gyp step needs python/make
  esbuild: false          # tsx's esbuild works without its postinstall
```

`.dockerignore` must list `node_modules`, because the host's darwin binaries must not be copied into the image.

### Sketch compose service

```yaml
services:
  userbot:
    build: .
    restart: unless-stopped
    init: true                # PID-1 signal forwarding / reaping
    env_file: .env
    volumes:
      - ./data:/app/data      # SQLite DB + Telegram session
    # no stdin_open/tty: not needed for `compose run`, and the daemon does not prompt
```

One-shot commands (the TTY is allocated automatically when run from a terminal):

```sh
docker compose run --rm userbot ./node_modules/.bin/tsx src/cli.ts login
docker compose run --rm userbot ./node_modules/.bin/tsx src/cli.ts resolve-channels
```

---

## Q1. Node version and Docker image

- The latest release is **v26.9.0, dated 2026-09-16**, with NODE_MODULE_VERSION (ABI) **147**. The latest v24 is 24.21.0 (2026-09-07), which is LTS "Krypton". Source: https://nodejs.org/dist/index.json.
- **Status:** 26.x is **Current**. Its Active LTS start is **2026-10-28**, maintenance starts 2027-10-20, and end of life is 2029-04-30. 24.x is Active LTS until 2026-10-20. The Release README says "Dates are subject to change." Sources: https://github.com/nodejs/Release#release-schedule, https://raw.githubusercontent.com/nodejs/Release/main/schedule.json.
  - schedule.json also shows `v27` with an `"alpha": "2026-10-28"` entry and a 2027-04-22 start. The release process is changing, but this does not affect the choice of 26.
- **Docker tags.** The official library file maps `26`, `26-slim`, `26-trixie-slim`, `26.9.0-trixie-slim` and `current-slim` to the same slim image. `26-bookworm-slim` and `26-alpine` (Alpine 3.24) also exist. Source: https://github.com/docker-library/official-images/blob/master/library/node.
  - Docker Hub lists `linux/arm64/v8` for `26`, `26-slim`, `26-trixie-slim`, `26-bookworm-slim` and `26-alpine`, all updated 2026-09-18/19. Source: `https://hub.docker.com/v2/repositories/library/node/tags/<tag>`.
- **slim vs alpine:**
  - The docker-node README says musl builds for arm64 "are not tested before release". It says Alpine uses musl and that "Generally, applications written for Debian (glibc) will not run under Alpine (musl)". Source: https://github.com/nodejs/docker-node#musl-builds-for-alpine.
  - `26/alpine3.24/Dockerfile` has a checksum for the unofficial musl tarball only on x86_64. On aarch64 it takes the "Building from source" branch. Source: https://github.com/nodejs/docker-node/blob/main/26/alpine3.24/Dockerfile.
  - `26/trixie-slim/Dockerfile` installs the official `node-v26.9.0-linux-arm64.tar.xz`, verified by GPG and checksum. It does **not** install corepack or yarn: its only smoke tests are `node --version` and `npm --version`. Source: https://github.com/nodejs/docker-node/blob/main/26/trixie-slim/Dockerfile.
  - Choose **slim**.
- The docker-node README also says "Production applications should only use LTS releases". 26 meets that on 2026-10-28, so it is not a practical concern here.

## Q2. Native SQLite on Node 26

**better-sqlite3**

- The latest release is **13.0.3** (2026-08-05). v13.0.0 (2026-07-21) notes: "the first version of better-sqlite3 to run on the N-API … prebuilt binaries should theoretically work across different versions of Node.js … we've removed the deprecated prebuild-install dependency, and now prebuilt binaries are published directly with the better-sqlite3 code itself. If your platform/architecture doesn't have a prebuilt binary, it should compile during install as before." Source: https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0.
- The v13 GitHub releases carry **no assets**, because the binaries are in the npm tarball. v12.12.0 still had per-ABI assets, including `node-v147-linux-arm64` and `node-v147-linuxmusl-arm64`.
- The contents of the npm tarball `better-sqlite3-13.0.3.tgz` were inspected **[verified locally]**:
  - It contains `prebuilds/linux-arm64.node` and `prebuilds/linuxmusl-arm64.node` (both ELF aarch64), plus darwin, win32 and linux-x64.
  - `package.json` has `"gypfile": false`, **no install script**, `engines.node: ">=22"`, and depends on `node-addon-api`.
  - `lib/binding.js` picks `prebuilds/<linux|linuxmusl>-<arch>.node` at runtime. It falls back to `build/Release` only if no prebuild matches.
  - `binding.gyp` builds nothing (`type: none`) when a prebuild exists (`prebuild_exists` is computed by `node lib/binding.js`). It builds with `NAPI_VERSION=10`.
- The glibc symbols required by `linux-arm64.node` go up to **GLIBC_2.34** (read with `strings` on the binary). v13.0.3 builds it on Ubuntu 22.04-arm (release notes, https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3). Debian trixie ships glibc 2.41, so it is compatible.
- **Result:** no toolchain is needed in `node:26-slim` or `node:26-alpine`, on glibc or musl, provided pnpm does not try to run node-gyp (see Q4). This was verified on darwin/x64 with ABI 147: `require('better-sqlite3')` worked **without** running any build script **[verified locally]**.

**node:sqlite**

- The Node v26.9.0 docs say "**Stability: 1.2 – Release candidate**". Its history: it was unflagged in v23.4.0/v22.13.0 but still experimental, and became release candidate in v25.7.0. Source: https://github.com/nodejs/node/blob/v26.9.0/doc/api/sqlite.md.
- It can only be imported as `node:sqlite` (schemeless block list in `lib/internal/bootstrap/realm.js`).
- On Node 26.7.0 it runs with no flag and prints no warning, and it bundles SQLite 3.53.4 **[verified locally]**.
- It is under active churn in 26.x: many sqlite fixes and new APIs in `CHANGELOG_V26.md`, for example `StatementSync.prototype.close()` and a diagnostics channel. Source: https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V26.md.
- It is workable and removes the native-module question entirely, but its API is not frozen. better-sqlite3 remains the lower-risk default now that the native problem is solved.

## Q3. tsx vs built-in type stripping

- **tsx 4.23.13** was published 2026-08-30 with `engines.node >=18.0.0`. Source: https://registry.npmjs.org/tsx. Its docs say it "is designed to be compatible with all maintained versions of Node.js". Source: https://github.com/privatenumber/tsx/blob/master/docs/getting-started.md.
- tsx 4.23.13 ran a `.ts` file on Node 26.7.0 under pnpm 12, **even with esbuild's postinstall skipped** **[verified locally]**.
- **Node type stripping** is `Stability: 2 - Stable` as of v25.2.0/v24.12.0. `--experimental-transform-types` was removed in v26.0.0. Source: https://github.com/nodejs/node/blob/v26.9.0/doc/api/typescript.md.
- Type stripping has these limits (same doc):
  - It only handles erasable syntax. Enums, parameter properties and namespaces are not supported. This was confirmed: `enum` throws on 26.7 **[verified locally]**.
  - File extensions are mandatory in imports.
  - It ignores `tsconfig.json`, so no `paths`.
  - Type-only imports need `import type` (use `verbatimModuleSyntax`).
  - It refuses to strip `.ts` under `node_modules`.
- The Node doc itself points to tsx for "full support".
- **Keep tsx.** There is no clear reason to drop it. Dropping it is possible later if the code keeps to erasable syntax (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`).

## Q4. pnpm in Docker

**Corepack**

- Node **25.0.0** landed "build: stop distributing Corepack (#57617)" as a SEMVER-MAJOR change, and "build: remove corepack from release tarballs (#59835)". Source: https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V25.md.
- The v26 changelog includes "doc: remove Corepack documentation page (#57663)".
- The `node:26` slim Dockerfile does not add corepack (Q1).
- Corepack still exists as an npm package (0.36.0, 2026-08-28; https://registry.npmjs.org/corepack), but using it now means an extra install step. It is not needed.

**pnpm 12**

- pnpm is at **12.4.2** (`latest`, 2026-09-15); 12.5.1 is on `next`. Source: https://registry.npmjs.org/pnpm.
- Its installation docs say: "pnpm 12 is a native executable and does not require Node.js after it is installed. Installing it through npm requires Node.js 22.13 or newer." Linux arm64 is supported on glibc and musl. The compatibility table lists Node 26. The docs no longer mention Corepack. Source: https://pnpm.io/installation (raw: https://github.com/pnpm/pnpm.io/blob/main/docs/installation.md).
- The npm `pnpm@12.4.2` package installs the right `@pnpm/exe.<platform>` binary via optionalDependencies, including `@pnpm/exe.linux-arm64`. That makes `npm install -g pnpm@12.4.2` on `node:26-slim` a valid and simple install.
- pnpm's Docker page recommends the official `ghcr.io/pnpm/pnpm:12` base image (Debian slim, **no Node bundled**), with Node installed via `pnpm runtime set node …` or `devEngines.runtime`. It adds that if you prefer your own Node base image, you can "install pnpm into that image instead". It suggests BuildKit cache mounts and `pnpm install --frozen-lockfile`. Source: https://pnpm.io/docker.
- Using `node:26-slim` + `npm i -g pnpm` keeps Node on the official Node image, which is simpler for this project.

**Build-script approval (pnpm 11+)**

- `onlyBuiltDependencies`, `neverBuiltDependencies`, `ignoredBuiltDependencies`, `onlyBuiltDependenciesFile` and `ignoreDepScripts` were **removed in v11** and replaced by **`allowBuilds`** (a map of package → true/false, in `pnpm-workspace.yaml`).
- `strictDepBuilds` defaults to **true**, which makes the install "exit with a non-zero exit code if any dependencies have unreviewed build scripts".
- `dangerouslyAllowAllBuilds` defaults to false.
- Source: https://pnpm.io/settings/build.

**Observed with pnpm 12.4.2 on Node 26.7.0 [verified locally]**

- `pnpm add better-sqlite3@13.0.3 tsx@4.23.13` fails with `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: better-sqlite3@13.0.3, esbuild@0.28.2`. It also writes placeholder `allowBuilds` entries into `pnpm-workspace.yaml`.
  - pnpm treats better-sqlite3's bare `binding.gyp` as an implicit `node-gyp rebuild` install script. It ignores `"gypfile": false`.
- With `allowBuilds: { better-sqlite3: false, esbuild: false }`, `pnpm install --frozen-lockfile` succeeds, and both better-sqlite3 and tsx work.
- With `better-sqlite3: true`, pnpm runs `node-gyp rebuild`. It completes as a no-op (`TOUCH …stamp`), but only because python3 and make exist on the Mac. On `node:26-slim` it would need `python3 make g++` or it would fail.
- **Use `false`.** If better-sqlite3 is later upgraded to a version or platform without a prebuild, flip it to `true` and add `python3 make g++` to the image.

## Q5. Interactive one-shot commands with `docker compose run`

- Compose docs describe `run` this way. It "runs a one-time command against a service" and the command "overrides the command defined in the service configuration". It "does not create any of the ports specified in the service configuration". Flags: `-i, --interactive`: "Keep STDIN open even if not attached" (**default true**). `-T, --no-tty`: "Disable pseudo-TTY allocation (default: auto-detected)". `--rm` removes the container on exit. Source: https://docs.docker.com/reference/cli/docker/compose/run/.
- The source (`cmd/compose/run.go`, https://github.com/docker/compose/blob/main/cmd/compose/run.go) shows:
  - `service.Tty = !options.noTty` and `service.StdinOpen = options.interactive`, so `run` **overrides** the service's `tty` and `stdin_open`.
  - Comment in the source: "while `docker run` requires explicit `-it` flags, Compose enables interactive mode and TTY by default". Without explicit flags, it disables the TTY only when stdin is not a terminal (for example, piped from a script).
- `stdin_open` and `tty` in the compose file correspond to `docker run -i` and `-t`. Source: https://docs.docker.com/reference/compose-file/services/. They only matter for `compose up` plus `docker attach`, which is not used here. `init: true` "runs an init process (PID 1) … that forwards signals and reaps processes" (same doc). It is useful for the long-lived service.
- **Practical implications:**
  - `docker compose run --rm userbot <login cmd>` from a normal terminal gets a TTY, so prompts for phone number, code and 2FA work.
  - Run it with the long-lived service stopped, or make sure both containers never use the same Telegram session file or SQLite database at once.
  - `--no-deps` is irrelevant because there is only one service.
  - Password prompts that hide input need a TTY, which the default provides. Under `-T` or a pipe they would need a non-TTY fallback.

## Open uncertainties

- **Nothing was run in an actual container.** Docker Desktop was not running. The linux-arm64 prebuild loading on `node:26-slim` is inferred from the tarball contents, the glibc symbol versions and `lib/binding.js`. It was not executed on linux/arm64. First build: run `docker compose run --rm userbot node -e "require('better-sqlite3')"`.
- **Local tests ran under x64 emulation.** The local nvm Node reports `process.arch` x64 (Rosetta), so the verification used the darwin-x64 prebuild, not arm64.
- **pnpm build policy may change.** pnpm's handling of implicit `binding.gyp` builds and of `gypfile: false` could change in a later 12.x. It is also unclear whether better-sqlite3 will add an explicit script. Re-check `allowBuilds` whenever either is upgraded.
- **better-sqlite3 13 is young.** The N-API port is two months old, with 3 patch releases so far. v12.12.0 (NAN, per-ABI assets incl. node-v147 linux-arm64) is a fallback, but it installs through `prebuild-install` (downloads at install time) and would need `allowBuilds: true`.
- **Node 26 is not LTS yet.** The LTS date of 2026-10-28 is "subject to change". Until then, 26 gets semver-minor changes, and node:sqlite and other APIs are still moving.
- **Image user and volume permissions.** Running as `USER node` (uid 1000) with a bind-mounted `./data` on macOS Docker Desktop usually works through file sharing, but check that the SQLite WAL/journal and the session file are writable.
