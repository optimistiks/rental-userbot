# 17: Albums and photos

**What to build:** a new album in a Watched channel is evaluated once, as one Post, with its photos shown to the model. Single messages with a photo also send it. See [spec](../spec.md) § [1] Telegram Adapter (photos), § [3] (split albums), § [4] Evaluator (before the run).

**Blocked by:** 16 (Dedupe Store and the one-at-a-time queue)

**Status:** resolved

- [x] Adapter registers `onMessageGroup` and merges it with `onNewMessage` into one Post stream; album Posts carry `albumId` (`groupedIdUnique`), ascending `messageIds`, and `link` of the first message
- [x] Text = non-empty captions/bodies joined with `"\n\n"`
- [x] Only `media.type === 'photo'` counts; videos and documents (and their thumbnails) are skipped; first 6 photos in message order kept
- [x] `downloadPhoto` fetches `getThumbnail('y') ?? getThumbnail('x') ?? photo` with `downloadAsBuffer`; no file-reference re-fetch
- [x] Photos are downloaded once, before the first agent run; a failed download is skipped and logged with the Post link
- [x] Photos go to the model as `{ type: 'file', mediaType: 'image', data }` after the text block; missing photos are not mentioned
- [x] If no text and no photos remain, the Verdict is No match without an agent run, and it is logged
- [x] A late album part with an already-processed `albumId` is dropped by the Dedupe Store
- [x] Integration test: an album Post is evaluated once with its photos in the request; a failing photo download still evaluates with the rest; an all-photos-failed, textless Post makes no agent run (Done-when 8)

## Comments

- 2026-09-20: Implemented the album/photo adapter and vision input flow. Added coverage for album ordering, caption joining, media filtering, thumbnail fallback, the six-photo cap, lazy downloads, failed downloads, empty Posts, and late album dedupe.
- 2026-09-20: `pnpm test` passes all 47 tests; `pnpm typecheck` and `git diff --check` pass. Standards and spec review both passed. Manual Telegram album acceptance remains pending because no live session was used.
