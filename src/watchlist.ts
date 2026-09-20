import { readConfiguredTextFile } from "./text-file.js";

/** The channel IDs the bot is watching, as the owner last wrote them. */
interface Watchlist {
  channelIds: () => number[];
}

const MARKED_CHANNEL_ID = /^-100\d+$/u;

function parseChannelIds(contents: string): number[] {
  const ids = new Set<number>();

  for (const line of contents.split("\n")) {
    const id = parseChannelId(line);
    if (id !== undefined) {
      ids.add(id);
    }
  }

  return [...ids];
}

/** A line counts only if it is a marked channel ID; anything else is the owner's own note. */
function parseChannelId(line: string): number | undefined {
  const [beforeComment = ""] = line.split("#");
  const candidate = beforeComment.trim();
  if (!MARKED_CHANNEL_ID.test(candidate)) {
    return undefined;
  }

  const id = Number(candidate);
  return Number.isSafeInteger(id) ? id : undefined;
}

function readWatchlistFile(channelsPath: string): number[] {
  return parseChannelIds(readConfiguredTextFile(channelsPath, "Watchlist"));
}

/* The file is re-read on every call, the way the Zone checker re-reads zone.geojson.
   Watching it for events was considered and rejected: the bot reads a bind mount from
   macOS Docker Desktop, which does not propagate host filesystem events into the
   container, so every watcher would have to poll a sub-kilobyte file anyway. */
function createWatchlist(channelsPath: string): Watchlist {
  let previous: number[] | undefined;

  return {
    channelIds() {
      // Total by design: a file that vanishes under a running bot means "watch nothing",
      // Never an error reaching the Post path.
      let channelIds: number[];
      try {
        channelIds = readWatchlistFile(channelsPath);
      } catch {
        channelIds = [];
      }

      if (previous !== undefined) {
        logChange(previous, channelIds);
      }
      previous = channelIds;
      return channelIds;
    },
  };
}

function logChange(previous: readonly number[], current: readonly number[]): void {
  const added = difference(current, previous);
  const removed = difference(previous, current);
  if (added.length === 0 && removed.length === 0) {
    return;
  }

  const parts = [`watching ${current.length} ${current.length === 1 ? "channel" : "channels"}`];
  if (added.length > 0) {
    parts.push(`added ${added.join(", ")}`);
  }
  if (removed.length > 0) {
    parts.push(`removed ${removed.join(", ")}`);
  }

  console.log(`watchlist: ${parts.join("; ")}`);
}

function difference(channelIds: readonly number[], other: readonly number[]): number[] {
  const excluded = new Set(other);
  return channelIds.filter((channelId) => !excluded.has(channelId));
}

export { type Watchlist, readWatchlistFile, createWatchlist };
