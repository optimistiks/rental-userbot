# Watchlist as an owner-edited file

**Status:** ready-for-agent

## Problem Statement

The Watched channels live in `CHANNEL_IDS`, an environment variable read once at startup. To add or remove a
channel the owner has to edit `.env` and run `docker compose up -d`, which recreates the container.

That restart is not free. `catchUp: false` means the bot never replays updates it slept through, so every
restart is a hole in coverage: any Post published while the container is coming back is lost, silently and
permanently. Changing the watchlist — the most routine adjustment the owner makes — is the one edit that
costs them Posts.

It is also inconsistent. The three other things the owner edits (`data/criteria.md`, `data/prompt.md`,
`data/zone.geojson`) are files on the data volume, re-read on every Post, and the README promises "Edits to
these take effect on the next post. No restart needed." The watchlist is the exception, for no reason the
owner can see.

## Solution

The watchlist becomes a fourth owner-edited file on the data volume: `data/channels.txt`, one channel ID per
line. The bot re-reads it on every Post, exactly as it re-reads the Criteria and the Zone, so adding or
removing a channel takes effect on the next Post with no restart, no reload and no rebuild.

The file is written by a human, so it is read forgivingly: a line counts only if it is a marked channel ID
(`-100` followed by digits), and every other line is ignored without complaint. That makes `#` comments and
`# labels` after an ID work for free, and means no edit to this file can ever take the bot down.

When the set of IDs the bot is watching changes, it says so in the console log, so the owner can confirm
from `docker compose logs -f userbot` that their edit was picked up.

`CHANNEL_IDS` is removed. `CHANNELS_PATH` replaces it, defaulting to `data/channels.txt`, alongside the
existing `CRITERIA_PATH`, `PROMPT_PATH` and `ZONE_PATH`.

## User Stories

1. As the owner, I want the Watched channels listed in a file on the data volume, so that I can change them
   with a text editor instead of an environment variable.
2. As the owner, I want a channel I add to the file to be watched from the next Post onward, so that I never
   restart the bot to adjust the watchlist.
3. As the owner, I want a channel I remove from the file to stop being watched from the next Post onward, so
   that I can drop a noisy channel the moment it annoys me.
4. As the owner, I want the watchlist edit to require no restart, so that I stop losing Posts to the
   coverage gap a restart creates.
5. As the owner, I want one channel ID per line, so that the format is obvious without documentation.
6. As the owner, I want to write a `#` comment line in the file, so that I can group or annotate my channels.
7. As the owner, I want to write a label after an ID, like `-1001234567890  # Batumi rentals`, so that I can
   tell my channels apart months later without opening Telegram.
8. As the owner, I want blank lines to be allowed, so that I can space the file out for readability.
9. As the owner, I want a line that is not a valid marked channel ID to be ignored rather than to break
   anything, so that a bad paste costs me nothing.
10. As the owner, I want the same ID listed twice to count once, so that a careless duplicate is harmless.
11. As the owner, I want reordering lines or editing a comment to change nothing about what is watched, so
    that tidying the file is safe.
12. As the owner, I want the bot to survive any content I can put in this file, so that editing the
    watchlist is never a risk to uptime.
13. As the owner, I want the bot to keep running when the file is empty, watching nothing, so that
    temporarily pausing the watchlist is a supported thing to do.
14. As the owner, I want the bot to keep running when the file disappears while it is running, so that a
    clumsy `mv` or a sync hiccup does not take it down.
15. As the owner, I want a console log line when the set of watched channels changes, so that I can confirm
    from the logs that my edit was picked up.
16. As the owner, I want that log line to show how many channels are watched and what changed, so that I can
    tell an addition from a removal at a glance.
17. As the owner, I want no log line when my edit changed nothing effective, so that the log means "what the
    bot watches changed", not "the file's bytes changed".
18. As the owner, I want nothing about a watchlist change sent to Saved Messages, so that Saved Messages
    stays reserved for matched Listings and the startup signal.
19. As the owner, I want the bot to refuse to start when the file is missing entirely, so that an incomplete
    `data/` setup fails loudly instead of quietly watching nothing forever.
20. As the owner, I want that startup failure to name the file, so that I know what to create.
21. As the owner, I want the `🟢 started, watching N/M channels` message to keep working off the file, so
    that the startup signal I already rely on is unchanged.
22. As the owner, I want the startup membership check to keep reporting channels I have not joined, so that
    I still learn about that at boot.
23. As the owner, I want to know that a channel added at runtime is not membership-checked until the next
    restart, so that I am not surprised when an unjoined channel is silently quiet.
24. As the owner, I want `CHANNEL_IDS` gone rather than kept as a fallback, so that there is exactly one
    place the watchlist lives.
25. As the owner, I want a `CHANNELS_PATH` override consistent with the other three path settings, so that
    the configuration surface stays uniform.
26. As the owner, I want `data.example/` to ship a starting `channels.txt`, so that `cp -r data.example data`
    leaves me with a complete setup.
27. As the owner, I want the README to document the file where it documents the other three, so that the
    setup instructions stay in one place.
28. As the owner, I want a Post from a chat that is not in the file to be ignored as before, so that the
    change is invisible to everything except how the list is configured.

## Implementation Decisions

**A new Watchlist module.** A module owning the watchlist file: it exposes the current channel IDs and is
the only thing that knows the file format. It reads the file on every call — no cache, no watcher, no timer
— matching how the Zone checker already re-reads `zone.geojson` per call. It holds the previously returned
set so it can detect a change and log it.

**The watcher was considered and rejected.** Event-driven watching (`fs.watch`, chokidar, watchman) cannot
work in this deployment: the bot runs in a Linux container reading a bind mount from macOS Docker Desktop,
which does not propagate host filesystem events into the container. Every such library would have to be
configured to poll to work at all, which is strictly more machinery than reading a sub-kilobyte file on each
Post. This decision is worth a comment in the module, since it makes the watchlist the one file whose read
model a future reader might question.

**Parsing is total — it never fails.** For each line: cut everything from the first `#`, trim, and keep it
only if it matches a marked channel ID (`-100` followed by digits) that is a safe integer. Everything else
is discarded without error or log. The result is deduplicated. A file that cannot be read at all — missing,
unreadable — yields an empty list at runtime rather than throwing. There is no error path from this module
into the running bot.

**Missing file is fatal at startup only.** Startup initialization gains a check that the watchlist file
exists and is readable, alongside the existing read-and-discard checks for the Criteria, Prompt and Zone
files, and fails naming the file. This is the asymmetry: a missing file at boot is an incomplete setup and
should be loud; a file that vanishes under a running bot is just an empty watchlist.

**Empty is valid, everywhere.** A file with no valid lines means "watch nothing". The bot starts, announces
`watching 0/0 channels`, and runs. This is deliberate: once the list is live-editable, temporarily watching
nothing becomes a legitimate state, and it is also what a half-written file looks like for the instant an
editor takes to save it.

**Change detection compares sets, not bytes.** The module compares the deduplicated IDs as an order-
independent set against the previous read. Reordering lines, editing a comment, adding a label or removing
a duplicate produces no log line. A change logs one line at `console.log` giving the new count and the
delta, in the existing log style (lowercase, colon-separated). Nothing is sent to Saved Messages.

**The Channel Filter stays pure.** `isWatchedPost` keeps its signature taking a Post and a list of IDs, and
keeps its unit test. The pipeline is what changes: instead of a frozen array of channel IDs fixed at
construction, it takes the Watchlist and asks it for the current IDs as each Post arrives. The filter itself
learns nothing about files.

**Where the read happens in the Post path.** The watchlist is consulted at the same point the channel check
already happens — first, before the empty-Post check and before the Dedupe Store — so an unwatched Post
still costs one file read and nothing else.

**Configuration.** `channelIds` leaves the settings object; `channelsPath` joins it, read from `CHANNELS_PATH`
with the default `data/channels.txt` exported as a constant beside the existing path constants.
`CHANNEL_IDS` and its parsing and validation are deleted outright — no fallback, no deprecation period.

**Startup announcement is unchanged in shape.** It still takes a list of channel IDs, still runs the dialog
scan, still produces `🟢 started, watching N/M channels` and the `not joined:` line and the per-channel
warnings. It now gets its list from the Watchlist's first read. The membership scan stays a startup-only
operation: it is a full dialog scan and re-running it on every file edit would be expensive and
flood-wait-prone, so a channel added at runtime is not membership-checked until the next restart. The README
says this explicitly.

**Documentation.** The README's `data/` table gains a `data/channels.txt` row, so the file is covered by the
existing "Edits to these take effect on the next post. No restart needed." promise. The "Finding your
channel IDs" section moves from describing an environment variable to describing the file, including the
comment and label syntax and the note about membership checks. The environment variable tables drop
`CHANNEL_IDS` and gain `CHANNELS_PATH` among the optional settings. `.env.example` follows. `CONTEXT.md`'s
**Watched channel** entry is reworded to name the file as the place the owner lists channels, keeping the
term itself intact.

## Testing Decisions

A good test here asserts what the owner observes: which Posts get evaluated, what the bot refuses to start
without, and what appears in the log. None of them should know how the file is parsed internally or how the
Watchlist stores its previous read. The feature's whole point — an edit taking effect without a restart —
must be proven by an actual mid-test rewrite of a real file, not by re-constructing anything.

**The live-reload behaviour tests at the existing post-pipeline seam.** Prior art is `pipeline.test.ts`,
which already builds a real pipeline against a fake Telegram, an in-memory Dedupe Store and a mock language
model, and already creates temp files. One test: point a pipeline's watchlist at a temp file listing one
channel, process a Post from it and see it evaluated and notified; rewrite the file to list a different
channel; process a second Post from the original channel and see it dropped with no evaluation and no send.
This is the highest seam that does not require new machinery — driving it through `runDaemon` would mean
capturing the registered message handler, which the existing `main.test.ts` does not do.

**Parsing rules test at a new unit seam on the Watchlist module.** Prior art is `text-file.test.ts` and
`zone.test.ts`, which test the other owner-edited file readers directly. Cases: plain IDs; whitespace and
CRLF; full-line `#` comments; a trailing `# label` after an ID; blank lines; junk lines; malformed IDs that
are not `-100…`; a value too large to be a safe integer; duplicates collapsing; an empty file; a file of
nothing but comments; a missing file reading as empty. Each rule through the pipeline instead would need a
full mock-model round-trip, which is why this seam exists separately.

**Change logging tests at that same unit seam**, with a `console.log` spy — the pattern `startup.test.ts`
and `pipeline.test.ts` already use. Cases: a first read logs nothing beyond what startup already reports; an
added ID logs once with the new count and the delta; a removed ID likewise; a reordered file, an added
comment, an added label and a removed duplicate each log nothing.

**The missing-file startup failure adds one case to the existing startup seam.** `startup.test.ts` already
has a case per owner-edited file asserting that initialization throws naming the file; this is the fourth,
written the same way.

**Deletions.** `config.test.ts` loses its `CHANNEL_IDS` cases: the required-settings list, the parsed-IDs
assertion and the unmarked-ID rejection. `channel-filter.test.ts` is untouched, since the filter's signature
does not change. `main.test.ts` and `startup.test.ts` fixtures swap `channelIds` for `channelsPath` pointing
at a temp file.

**The full check before handing back:** `pnpm lint`, `pnpm fmt`, `pnpm test`, `pnpm typecheck`.

## Out of Scope

- **Channel usernames instead of numeric IDs.** Resolving `@name` to an ID needs a Telegram call and a new
  method on the Telegram boundary. The file takes marked numeric IDs, as `CHANNEL_IDS` did.
- **Re-running the membership check when the file changes.** It is a full dialog scan; it stays at startup.
- **Notifying Saved Messages about watchlist changes.** The console log is the confirmation channel.
- **Event-driven file watching.** Rejected above on deployment grounds.
- **Validating that an ID is a real, existing channel.** Nothing can distinguish a typo'd but well-formed ID
  from a real one without a Telegram call.
- **Any change to how the bot joins channels.** It never joins anything; the owner's account must already
  have joined every channel it watches.
- **Reporting which lines were skipped.** Deliberately silent; the owner reads the count in the startup
  message and the change log against the lines they wrote.
- **A restart policy change.** `restart: "no"` stays, and is no longer reachable by editing this file.

## Further Notes

The asymmetry between a missing file at startup (fatal) and at runtime (empty) is intentional and is the
only place the feature is not uniform. It exists because the two situations mean different things: at boot,
a missing file means the setup was never completed; at runtime, it means something moved a file under a
process that was working a second ago, and killing the bot for that would be a worse outcome than watching
nothing until the file returns.

Silent skipping of malformed lines was chosen over failing loudly after weighing the alternative. Failing on
a malformed line only ever catches typos that break the *shape* of an ID — a typo in a digit produces a
perfectly valid ID for a channel that does not exist, and no validation can catch that. A rule that catches
half the typos is not worth paying for in uptime or in complexity, so the file is read forgivingly and the
owner checks the count.

The log line is the only feedback that an edit was picked up, and it only appears when the next Post arrives.
On a quiet account that can be a while, so an owner who wants immediate confirmation reads the count in the
next `🟢 started` message after a restart — or simply waits.
