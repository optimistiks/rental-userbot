# 17: Albums and photos

**What to build:** a new album in a Watched channel is evaluated once, as one Post, with its photos shown to the model. Single messages with a photo also send it. See [spec](../spec.md) § [1] Telegram Adapter (photos), § [3] (split albums), § [4] Evaluator (before the call).

**Blocked by:** 16 (Dedupe Store and the one-at-a-time queue)

**Status:** ready-for-agent

- [ ] Adapter registers `onMessageGroup` and merges it with `onNewMessage` into one Post stream; album Posts carry `albumId` (`groupedIdUnique`), ascending `messageIds`, and `link` of the first message
- [ ] Text = non-empty captions/bodies joined with `"\n\n"`
- [ ] Only `media.type === 'photo'` counts; videos and documents (and their thumbnails) are skipped; first 6 photos in message order kept
- [ ] `downloadPhoto` fetches `getThumbnail('y') ?? getThumbnail('x') ?? photo` with `downloadAsBuffer`; no file-reference re-fetch
- [ ] Photos are downloaded once, before the first model attempt; a failed download is skipped and logged with the Post link
- [ ] Photos go to the model as `{ type: 'file', mediaType: 'image', data }` after the text block; missing photos are not mentioned
- [ ] If no text and no photos remain, the Verdict is No match without a model call, and it is logged
- [ ] A late album part with an already-processed `albumId` is dropped by the Dedupe Store
- [ ] Integration test: an album Post is evaluated once with its photos in the request; a failing photo download still evaluates with the rest; an all-photos-failed, textless Post makes no model call (Done-when 8)
