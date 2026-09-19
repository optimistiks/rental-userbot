# mtcute facts for the rental userbot

Researched 2026-09-19 against the **published npm tarballs** of `@mtcute/core`, `@mtcute/node` and `@mtcute/dispatcher` **0.32.1** (unpacked with `npm pack`), the `mtcute/mtcute` GitHub repo (`master`, docs under `docs/guide/`, releases), and core.telegram.org. Paths like `core/highlevel/updates/manager.js` are relative to the unpacked package (`core/` = `@mtcute/core@0.32.1`, `node/` = `@mtcute/node@0.32.1`, `dispatcher/` = `@mtcute/dispatcher@0.32.1`).

## Summary / recommendations

- **Pin `@mtcute/node` and `@mtcute/dispatcher` to exactly `0.32.1`** (released 2026-08-30). Both depend on `@mtcute/core ^0.32.1`. mtcute is 0.x, so a minor bump can break things; 0.31.0 dropped Node 20. Use **Node 22 or newer**.
- Client config: `new TelegramClient({ apiId, apiHash, storage: '/data/session.sqlite', updates: { catchUp: true, messageGroupingInterval: 250 } })`. Both options go in the same `updates` object.
- **Albums are not delivered twice.** When `messageGroupingInterval > 0`, album messages go only to `onMessageGroup`, never to `onNewMessage`. Handle both: `onNewMessage` for single posts, `onMessageGroup` for albums.
- ⚠ **The album timer is not a sliding window.** It starts at the first message of an album and never resets. If an album part arrives more than `messageGroupingInterval` ms after the first, it goes out as a **second `message_group`** with the same `groupedId`. The docs describe this differently from what the code does. Deduplicate and merge by `groupedIdUnique`, not by assuming one event per album.
- ⚠ **catchUp does cover channels we have joined but never opened, with limits.** Recovery starts from `updates.getDifference`, and Telegram sends `updateChannelTooLong` for each channel that has missed posts. mtcute then pages through `getChannelDifference` (100 per request for user accounts) from the **channel pts it saved to SQLite**. There are two ways to lose posts:
  - If the backlog was deleted from the channel's update box (`channelDifferenceTooLong`), mtcute dispatches only "the latest messages", so older posts in the gap are lost.
  - If no pts was ever saved for a channel (no update from it while the bot was running), the starting point is the `pts` field of `updateChannelTooLong`. It is unclear whether that gives any backlog (see Open uncertainties).
- ⚠ **catchUp can re-deliver messages**, especially after an unclean shutdown. The saved pts can also move forward before our async handler finishes. Keep our own dedupe table keyed by `(chatId, msgId)`.
- Chat IDs are **marked** numbers: `-100…` for channels. Bare ID = `-1e12 - markedId` (`toggleChannelIdMark`). `Message.link` already builds `t.me/<username>/<id>` or `t.me/c/<bare>/<id>`.
- Photos: `await tg.downloadAsBuffer(msg.media)` returns a **`Uint8Array`**, not a Buffer. For a `Photo` it downloads the **largest server size**. To get a "standard" size, pick `photo.getThumbnail('x')` (800px) or `'y'` (1280px). Videos and documents are separate media types. They have their own `thumbnails`.
- Send with `tg.sendText('me', text, { disableWebPreview: true })`. A plain string is sent as-is, with no markdown parsing. The sent message is **not** dispatched back to our own handlers by default.
- Login: `@mtcute/node`'s `tg.start()` prompts on stdin for phone, code and 2FA using `readline`. On later runs `start()` calls `getMe()` first and returns immediately if the saved session is valid. Run the first login with `docker run -it`.
- Storage: the `@mtcute/node` SqliteStorage uses **better-sqlite3** (`^12.10.0`, currently 12.11.1), a native module with WAL on. Prebuilt binaries exist for linux-arm64 (glibc and musl) on Node 22, 24, 25 and 26. **Run `npm ci` inside the image**; never copy macOS `node_modules` into it. Our dedupe table can live in the same file, through `storage.driver.registerMigration` or `onLoad`, or in a separate better-sqlite3 file.
- Membership check: `iterDialogs()` **excludes archived chats by default**. Pass `archived: 'keep'`, otherwise muted or archived rental channels look "not joined".

---

## 1. Versions and pinning

- Latest published versions: `@mtcute/node` 0.32.1, `@mtcute/dispatcher` 0.32.1 and `@mtcute/core` 0.32.1, all published 2026-08-30 (`npm view @mtcute/node time`). The previous release was 0.32.0 (2026-08-27).
- `@mtcute/node@0.32.1` depends on `@mtcute/core ^0.32.1`, `@mtcute/html-parser ^0.32.1`, `@mtcute/markdown-parser ^0.32.1`, `@mtcute/wasm ^0.32.0`, `@fuman/{utils,net,node} 0.0.21` and `better-sqlite3 ^12.10.0` (`node/package.json`).
- `@mtcute/dispatcher@0.32.1` depends on `@mtcute/core ^0.32.1` and `@fuman/utils 0.0.21` (`dispatcher/package.json`). No other `@mtcute/*` packages are needed. `@mtcute/node` re-exports the client, and the TL schema is bundled in core (`core/tl/`).
- Pinning: every package is released in lockstep under one version tag (see the GitHub releases list, e.g. v0.32.1 and v0.32.0). With 0.x versions, `^0.32.1` means `>=0.32.1 <0.33.0`, so npm will not cross a minor version by itself. The dispatcher imports `TelegramClient` from `@mtcute/core/client.js` (`dispatcher/dispatcher.d.ts`, line 2). Mismatched versions could therefore install two copies of core. **Pin both to the same exact version** and commit the lockfile.
- Node version: release v0.31.0 says "**❗ BREAKING** chore!: drop node20 support" (https://github.com/mtcute/mtcute/releases/tag/v0.31.0). No `engines` field is declared, so nothing enforces this at install time.

## 2. Updates

### Configuration

The official docs (https://github.com/mtcute/mtcute/blob/master/docs/guide/intro/updates.md, rendered at https://mtcute.dev/guide/intro/updates):

```ts
const tg = new TelegramClient({
  // ...
  updates: {
    messageGroupingInterval: 250,
    catchUp: true
  }
})
```

- The Node `TelegramClient` passes the whole `opts` to `BaseTelegramClient`, which reads `updates` as `UpdatesManagerParams` (`catchUp`, `channelPtsLimit`, `onChannelTooLong` and others). It also reads `opts.updates.messageGroupingInterval` for the parsed-update handler (`node/client.js`; `core/client.js` lines 364-370; `core/highlevel/base.d.ts` line 20; `core/highlevel/client.d.ts` line 73).
- The updates loop starts automatically once logged in: `notifyLoggedIn()` calls `startLoop()` (`core/highlevel/updates/manager.js` lines 114-116), and `start()` calls `notifyLoggedIn` (`core/highlevel/methods/auth/start.js`).
- `catchUp` doc comment: "Whether to catch up with missed updates when starting updates loop. > Note: In case the storage was not properly closed the last time, 'catching up' might result in duplicate updates." (`core/highlevel/updates/types.d.ts`)
- With `catchUp: false`, `startLoop()` calls `_fetchUpdatesState()`. That call runs `updates.getState`, then `getDifference`, but **only to move the state forward, without dispatching anything**. Missed messages are skipped (`manager.js` lines 146-149 and 297-349).

### What catchUp recovers

- `catchUp()` injects a synthetic `updatesTooLong` (`manager.js` lines 192-200). The loop then calls `updates.getDifference` using the saved `pts/qts/date/seq` (`_fetchDifference`, lines 818-889). New messages from the common difference are dispatched. For each `updateChannelTooLong` in the difference, it calls `_fetchChannelDifferenceLater(channelId, upd.pts)` (lines 855-864).
- This matches Telegram's own guidance: "updates.getChannelDifference does *not* have to be manually called for all channels on startup. Instead, [it] will be automatically triggered (only for channels that need catching up) by a set of updateChannelTooLong updates." (https://core.telegram.org/api/updates)
- `_fetchChannelDifference` (lines 669-779):
  - Starting pts: in-memory `cpts`. While catching up it falls back to `storage.updates.getChannelPts(channelId)`, then to the `pts` field of `updateChannelTooLong`. With no starting pts at all it gives up and falls back to the common difference.
  - It needs the channel's access hash in the peer storage (`storage.peers.getById`). Without it: "input peer not found", and the channel is skipped.
  - It loops `updates.getChannelDifference` with `force: true` and `limit = 100` for users, until `final` (see `_channelPtsLimit`, lines 41-51). Telegram: "Ordinary (non-bot) users are supposed to pass 10-100" (https://core.telegram.org/method/updates.getChannelDifference).
  - On `channelDifferenceTooLong`, it dispatches only `diff.messages`, and resets pts to `dialog.pts`. Telegram describes these messages as "The latest messages (not starting from the passed pts, just the latest messages)" (https://core.telegram.org/constructor/updates.channelDifferenceTooLong). **Posts in the gap beyond those are lost.** You can override this with `onChannelTooLong`.
  - On `CHANNEL_PRIVATE` or `CHANNEL_INVALID` (we left or were banned), the channel is marked inaccessible and skipped (lines 780-805).
- Where channel pts come from: any live channel update that gets applied sets `cpts` and `cptsMod` (lines 975-978). They are saved to SQLite with `setManyChannelPts` after every loop tick, through `_saveUpdatesStorage(true)` at line 1563. So only channels that produced at least one update while the bot was running have a saved pts.
- How far back: there is no time window in mtcute. The limit is how long Telegram keeps each update box. For the common box, `differenceTooLong` makes mtcute just take the new pts (lines 831-834), so nothing is dispatched.
- **Channels we have not opened (no `openChat`)**: joined channels still produce `updateChannelTooLong` in the common difference (per the Telegram doc above), so catch-up does reach them. mtcute's docs warn: "You will still receive updates for channels you are a member of, but they might be delayed." For channels we are **not** members of, `openChat` is required (`docs/guide/intro/updates.md`, "Opening chats"). Telegram: "the API may stop sending updates (or send fewer updates) for some channels/supergroups: thus clients (user accounts only) should also additionally invoke updates.getChannelDifference periodically for channels and supergroups the user is currently viewing" (https://core.telegram.org/api/updates).
- Keep-alive: with no updates for more than 15 minutes, mtcute triggers a getDifference by itself (`_onKeepAlive`, `manager.js` lines 128-131). This partly makes up for delayed passive delivery.
- Catch-up runs in the background. Progress is visible through `onConnectionState` (`updating` / `connected`) and `updates.onCatchingUp` (`manager.js` lines 107 and 136-145).
- Crash semantics: the dispatcher runs handlers fire-and-forget. `dispatchUpdate` and `dispatchRawUpdate` do not return a promise to the updates manager (`dispatcher/dispatcher.js` lines 140-149). pts is saved after each tick whatever the handlers do. A crash in the middle of a handler can therefore lose that message, and an unclean shutdown can re-deliver messages. This is the reason to keep a dedupe table and record "handled" only after a successful send.

### Albums (`message_group`)

- Implementation (`core/highlevel/updates/parsed.js`; the same in `packages/core/src/highlevel/updates/parsed.ts` on `master`):
  - With `messageGroupingInterval` set, each `new_message` that has `groupedIdUnique` is buffered in a map.
  - When the first message of a group arrives, **one timer** is started. When it fires, it emits `{ name: 'message_group', data: Message[] }`.
  - The early `return` means these messages are **never emitted as `new_message`**. The doc comment says so: "the updates being grouped **will not** be dispatched on their own."
- `groupedIdUnique` is `${groupedId.low}|${groupedId.high}|${markedPeerId}` (`core/highlevel/types/messages/message.js` lines 139-142).
- ⚠ The timer is **not reset** when later parts arrive. The docs say "It is a number of milliseconds to wait for the next message in the album. If the next message is not received in that time, the album is considered complete", but the code dispatches `interval` ms after the **first** part. A part arriving later starts a **new** group entry with the same key, which becomes a second `message_group` event. The docs also warn it "may sometimes break ordering" (`docs/guide/intro/updates.md`).
- Without `messageGroupingInterval` (default 0), album parts arrive as separate `new_message` events and `message_group` never fires.
- Dispatcher shape: `dp.onMessageGroup([filter,] async (ctx) => …)`.
  - `ctx` is a `MessageContext` built from the **last** message of the array.
  - `ctx.messages` is `MessageContext[]` in arrival order (not sorted by id).
  - `ctx.isMessageGroup === true` (`dispatcher/context/message.js` lines 1-20; `dispatcher/dispatcher.d.ts` lines 440-456).
  - Filters run against that context, e.g. `filters.chatId(...)`, which takes marked IDs or usernames (`dispatcher/filters/chat.d.ts` line 26).
  - The caption is usually on one of the parts, conventionally the first. mtcute's `sendMediaGroup` doc says "add caption to the first media in the group". So look for text in all of `ctx.messages`.

### New messages only

- Register only `dp.onNewMessage(...)` and `dp.onMessageGroup(...)`. Edits go to `edit_message` / `onEditMessage` and deletes to `delete_message` / `onDeleteMessage`. These are separate update names and never reach the new-message handlers (`core/client.js` lines 370-386; `dispatcher/dispatcher.js` lines 757 and 765).
- Messages recovered by catch-up are dispatched as `new_message` as well: they go through `messageToUpdate(message)` into the same pipeline (`manager.js` lines 752-755 and 844-852).

## 3. Channel ID format and links

- `Chat.id` is the "Marked ID of this chat" (`core/highlevel/types/peers/chat.d.ts` line 27). For channels it is `-1e12 - bareId`, i.e. `-100…` (`core/utils/peer-utils.js`: `ZERO_CHANNEL_ID = -1e12`, `getMarkedPeerId` and `toggleChannelIdMark(id) = ZERO_CHANNEL_ID - id`).
- `msg.chat.id` is marked. Store `CHANNEL_IDS` as marked `-100…` numbers so they compare directly and work with `filters.chatId`.
- Bare ID for `t.me/c/` links: `toggleChannelIdMark(markedId)`, exported from `@mtcute/core` utils, or `-1e12 - markedId`.
- `Message.link` builds the link for us (`message.js` lines 470-478): `https://t.me/${chat.username}/${id}` when the channel has a username, otherwise `https://t.me/c/${toggleChannelIdMark(chat.id)}/${id}`. It throws for non-channel chats.
- Username: `Chat.username` returns `raw.username ?? raw.usernames?.[0].username ?? null`, and `Chat.usernames` returns the full list (`chat.js` lines 282-292).

## 4. Photos

- `msg.media` is a `MessageMedia` union: `Photo | Video | Document | Audio | …`, or `null` (`core/highlevel/types/messages/message-media.d.ts` line 21). Branch on `media.type === 'photo'`.
- `tg.downloadAsBuffer(location, params?)` returns **`Promise<Uint8Array>`** (`core/highlevel/methods/files/download-buffer.d.ts`). Wrap it with `Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)` if a Buffer is needed. Its note says it "_will_ download the entire file into memory at once".
- `Photo` is itself a `FileLocation` pointing at the **largest** size: the `photoSizeProgressive` size if there is one, otherwise the biggest `photoSize` by byte size (`core/highlevel/types/media/photo.js` lines 7-44). `photo.thumbnails` and `photo.getThumbnail(type)` return `Thumbnail` objects, which are also `FileLocation`s and so can be downloaded (`thumbnail.d.ts` line 6). The type constants are `THUMB_800x800_BOX='x'`, `THUMB_1280x1280_BOX='y'` and `THUMB_2560x2560_BOX='w'`.
- Telegram size types: `x` "bounded by 800x800", `y` "bounded by 1280x1280", `w` "bounded by 2560x2560", `m` 320, `s` 100 (https://core.telegram.org/api/files#image-thumbnail-types). Telegram keeps no "original" for compressed photos. The largest server size is the full photo, usually `y`, or `w` for large photos.
  - Recommendation for "standard": `photo.getThumbnail('y') ?? photo.getThumbnail('x') ?? photo`. Watch out: a `photoSizeProgressive` entry has type `y` too, and it is also what the `Photo` object points at.
- Videos and documents in albums: they come as `Video` (`type: 'video'`) or `Document` in `ctx.messages[i].media`. Telegram allows "grouping photos into albums and generic files (audio, documents) into media groups", with at most 10 per group (https://core.telegram.org/api/files, albums section); photo albums can include videos. To skip them, filter `media?.type === 'photo'`. `Video` and `Document` have `thumbnails` if a preview image is wanted (`document.d.ts` lines 29-43).
- File references expire, and mtcute does not refresh them automatically. Open issue #40 "file reference support" (https://github.com/mtcute/mtcute/issues/40). Download soon after receiving the message, and re-fetch the message on `FILE_REFERENCE_EXPIRED`.
- Since v0.30.2, core throttles parallel downloads to avoid flood waits ("feat(core): throttle parallel downloads and uploads to avoid flood waits", https://github.com/mtcute/mtcute/releases/tag/v0.30.2). The `mediaThrottle` middleware is in the default stack (`core/network/middlewares/default.js`).

## 5. Sending

- `tg.sendText(chatId, text, params)`: `chatId` accepts `"me"` or `"self"`, which resolve locally to `inputPeerSelf` with no network call (`core/highlevel/methods/users/resolve-peer.js`). `params.disableWebPreview?: boolean` maps to `noWebpage` (`send-text.d.ts`; `send-text.js` line 70).
- `InputText = string | TextWithEntities` (`core/highlevel/types/misc/entities.d.ts` line 15). A plain string is sent as-is, with no parse mode (`normalize-text.js`). Markdown or HTML need the `md`/`html` helpers from the parser packages.
- No self-echo: by default (`disableNoDispatch: false`), updates caused by our own `sendText` are **not** dispatched to our handlers. The docs example says it "will only be printed once" (`core/highlevel/updates/types.d.ts`, `disableNoDispatch`).

## 6. Login

- `@mtcute/node` `TelegramClient.start(params)` (`node/client.js`): when `phone`, `code` or `password` is missing, it fills them with `readline` prompts `"phone > "`, `"code > "` and `"2fa password > "` on stdin/stdout, and closes readline afterwards.
- Core `start()` (`core/highlevel/methods/auth/start.js`) calls `getMe()` first.
  - If that succeeds, the saved session is valid: it logs "Logged in as …", calls `notifyLoggedIn` (which starts the updates loop), and returns the `User` **without prompting**.
  - `AUTH_KEY_UNREGISTERED` leads to the interactive flow.
  - `SESSION_REVOKED`, `USER_DEACTIVATED` and `USER_DEACTIVATED_BAN` lead to `logOut`, then the interactive flow.
  - `SESSION_PASSWORD_NEEDED` leads to the 2FA prompt.
- `start()` also offers `codeSentCallback` (default `console.log`), `invalidCodeCallback` (re-prompt instead of aborting), `qrCodeHandler` (QR login), and `session` (import a string session). Its doc: "intended for *interactive* login. If you are building some kind of headless service, you will most likely want to use the underlying authorization methods directly."
- Session reuse needs nothing extra: the auth key lives in the SQLite storage file. Headless runs can detect "not logged in" by calling `tg.start({ phone: () => { throw … } })`, or `tg.getMe()` inside a try/catch after `tg.connect()`, and failing fast.
- In Docker, run the first login with `docker run -it` (TTY and stdin needed) against the same volume.

## 7. Read-only lookups

- `resolvePeer(x)` / `getChat(x)` (`core/highlevel/methods/users/resolve-peer.js`; `core/highlevel/methods/chats/get-chat.js`):
  - A string `@user` or `user` is looked up in the storage cache first, then with **`contacts.resolveUsername`**. This does not join.
  - A number (marked ID) is looked up in storage, then refreshed through the cached username, then tried with `channels.getChannels` and `accessHash: 0`. That last attempt usually fails for channels not already cached, with `MtPeerNotFoundError("… not found in local cache")`.
  - `getChat` on an invite link (`t.me/+hash` or `joinchat/`) calls `messages.checkChatInvite`. This does not join, and it throws "You haven't joined …" when we are not a member.
  - **Neither function parses `https://t.me/<username>` URLs.** Strip `https://t.me/` and anything after `/` ourselves. `INVITE_LINK_REGEX` in `core/highlevel/utils/peer-utils.js` only matches invite links.
  - `getMessageByLink(link)` exists for message links (`get-message-by-link.d.ts`).
- The returned `Chat` has `id` (marked), `title`, `username`, `chatType` (`'channel'` / `'supergroup'` / …) and `isMember` (`!raw.left`, `chat.js` lines 202-211). That is enough for `resolve-channels` output and the membership check.
- Listing dialogs: `tg.iterDialogs({ archived: 'keep' })` returns an async iterator of `Dialog`s. `messages.getDialogs` is paged, `chunkSize` defaults to 100. ⚠ The **default is `archived: 'exclude'`** (`core/highlevel/methods/dialogs/iter-dialogs.d.ts`). Match titles with `dialog.chat.title`. `findDialogs` also exists.
- Flood-wait risk:
  - Telegram documents no FLOOD errors on `contacts.resolveUsername` (https://core.telegram.org/method/contacts.resolveUsername). mtcute's default flood waiter still treats flood waits generically: it sleeps automatically for waits up to **10 s**, retries at most **5** times, and throws `FLOOD_WAIT_X` above that (`core/network/middlewares/flood-waiter.d.ts`). You can raise the limit per call with `floodSleepThreshold` (`network-manager.d.ts` line 108).
  - Keep `resolve-channels` a one-off. At runtime, resolve from the **cache** by marked ID, not by username.
  - A startup `iterDialogs` over a few hundred dialogs is a handful of `getDialogs` calls.
  - Avoid `openChat`: the docs warn "avoid opening more than 5-10 chats at once … you might start getting transport errors or even get banned" (`docs/guide/intro/updates.md`).

## 8. Storage

- Driver: `@mtcute/node` `SqliteStorage` wraps `SqliteStorageDriver`, which does `import sqlite3 from "better-sqlite3"`. It sets `journal_mode = WAL` unless `disableWal` is passed (`node/sqlite/driver.js`, `node/sqlite/index.js`). The docs confirm "Node.js: better-sqlite3 … Deno: node:sqlite" (`docs/guide/topics/storage.md`).
- File location: `storage` may be a string path, and defaults to `"client.session"` **relative to the current working directory** (`node/client.js`: `new SqliteStorage(opts.storage)` / `new SqliteStorage("client.session")`). WAL adds `-wal` and `-shm` files next to it. The docs suggest a folder, e.g. `new SqliteStorage('storage/my-account')`. In Docker: `storage: '/data/tg.session'` on a mounted volume.
- Tables: mtcute's own tables plus `mtcute_migrations (repo, version)` (`core/storage/sqlite/driver.js`).
- Sharing the file for our dedupe table:
  - `BaseSqliteStorageDriver` exposes `db` (the better-sqlite3 `Database`), `registerMigration(repo, version, fn)` (must be called **before** load), and `onLoad(cb)` (`core/storage/sqlite/driver.d.ts`). The storage exposes `.driver` (`core/storage/sqlite/index.d.ts`).
  - So `const storage = new SqliteStorage(path); storage.driver.registerMigration('rental', 1, db => db.exec('create table …'))`, then use `storage.driver.db` after `tg.start()`.
  - mtcute batches its own writes (`_writeLater`, flushed in `_save`). Our direct writes on the same connection are independent of that.
  - The simpler option is a second better-sqlite3 file (e.g. `/data/app.sqlite`). It uses the same native dependency, so there is nothing extra to install, and it stays clear of mtcute's migrations.
- Native module:
  - `better-sqlite3@12.11.1` is the current latest 12.x on npm. Its engines allow Node 20-26, and it installs with `prebuild-install || node-gyp rebuild --release`.
  - The v12.11.1 GitHub release has prebuilt `node-v127/v137/v141/v147-linux-arm64` and `linuxmusl-arm64` tarballs (Node 22, 24, 25, 26) (`gh release view v12.11.1 -R WiseLibs/better-sqlite3`).
  - On `node:22`/`node:24` (Debian) or Alpine arm64 images no compiler is needed, but `npm ci` must run **inside** the image. The macOS host's `.node` binary will not load in Linux.
  - better-sqlite3 13.x exists (engines `>=22`), but mtcute 0.32.1 asks for `^12.10.0`, so it will not be picked.
- Known issue: #89 (closed) shows "SqliteError: database disk image is malformed" from a corrupted session. The maintainer's response: "this error is unrelated to this library, your storage got corrupted" (https://github.com/mtcute/mtcute/issues/89). Keep the volume on a local disk and shut down cleanly: mtcute registers a `beforeExit` hook that saves and closes the database (`core/storage/sqlite/driver.js`, `_load`).

## 9. Stability notes

- Release pace: 14 releases between 2026-03 and 2026-08 (`npm view @mtcute/node time`). Recent breaking changes:
  - v0.31.0 dropped Node 20.
  - v0.31.0 made `NetworkManagerParams.stopSignal` stop aborting on disconnect (only matters for custom middlewares).
  - v0.31.0 moved to TL layer 228, and v0.32.0 to layer 229.
- Relevant fixes: v0.31.0 "don't crash updates loop on updateChannel for unknown channel"; v0.30.1 "postponed update handling"; v0.32.0 "correctly track multiple in-flight pings" (https://github.com/mtcute/mtcute/releases).
- The updates loop restarts itself on errors ("updates loop encountered error, restarting", `manager.js` lines 1566-1570), but errors in the dispatcher's handlers go to `client.onError`, or to `console.error` if nothing is registered (`dispatcher/dispatcher.js` lines 140-149). Register `tg.onError.add(...)` and `dp.onError(...)`.
- Open issues touching this plan (https://github.com/mtcute/mtcute/issues, 13 open):
  - #40 file reference support: no automatic refresh of expired references.
  - #111 "Enabling usePfs makes file downloading much slower": leave `usePfs` off.
  - #50 "proper tests for Dispatcher".
  - No open issues mention catchUp or albums.

## Open uncertainties

1. **What `updateChannelTooLong.pts` is.** Telegram only says "The PTS" (https://core.telegram.org/constructor/updateChannelTooLong). If it is the channel's *current* pts, then after a restart a channel with **no saved pts** (silent since the session file was created) gets an empty difference, and its missed posts are dropped. Verify empirically: stop the bot, post in a test channel, restart, and check the debug log for `getChannelDifference (cid=…) returned N messages`. To reduce the risk, fetch the last few posts per channel on startup with `getHistory`, a read-only call, and let the dedupe table filter them.
2. How reliably Telegram sends `updateChannelTooLong` for large broadcast channels that were never opened. The docs speak of "fewer updates" and "delayed". If they are unreliable, a low-rate `getHistory` poll could be a fallback.
3. Whether `chat.username` is present on messages whose peer comes as `min`. `Chat.isMin` exists (`chat.js` line 56). Channel usernames are normally included, but this was not verified. Fall back to the `t.me/c/` link, which `Message.link` already does.
4. With a 250 ms interval, how often album parts are split across two `message_group` events in practice. Parts usually arrive together in a single `updates` container, so it is probably rare, but it happens in real time as well as during catch-up.
5. Whether a progressive-JPEG `y` returned by `getThumbnail('y')` downloads the full progressive file. It points at the same location as `Photo` itself, so it probably does.
