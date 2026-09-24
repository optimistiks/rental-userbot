import { readTextFile } from "./text-file.js";

const MARKED_CHANNEL_ID = /^-100\d+$/u;

/** A line counts only if it is a marked channel ID; anything else is the owner's own note. */
function readWatchlistFile(channelsPath: string): number[] {
  const ids = readTextFile(channelsPath, "Watchlist")
    .split("\n")
    .map((line) => line.split("#", 1)[0].trim())
    .filter((candidate) => MARKED_CHANNEL_ID.test(candidate))
    .map(Number)
    .filter((id) => Number.isSafeInteger(id));
  return [...new Set(ids)];
}

/* The file is re-read on every call, the way the Zone checker re-reads zone.geojson.
   Watching it for events was considered and rejected: the bot reads a bind mount from
   macOS Docker Desktop, which does not propagate host filesystem events into the
   container, so every watcher would have to poll a sub-kilobyte file anyway.
   Total by design: a file that vanishes under a running bot means "watch nothing",
   never an error reaching the Post path. */
function watchedChannelIds(channelsPath: string): number[] {
  try {
    return readWatchlistFile(channelsPath);
  } catch {
    return [];
  }
}

function watchingMessage(count: number): string {
  return `watching ${count} ${count === 1 ? "channel" : "channels"}`;
}

function watchlistChangeMessage(
  previous: readonly number[],
  current: readonly number[],
): string | undefined {
  const added = current.filter((channelId) => !previous.includes(channelId));
  const removed = previous.filter((channelId) => !current.includes(channelId));
  if (added.length === 0 && removed.length === 0) {
    return undefined;
  }

  const parts = [watchingMessage(current.length)];
  if (added.length > 0) {
    parts.push(`added ${added.join(", ")}`);
  }
  if (removed.length > 0) {
    parts.push(`removed ${removed.join(", ")}`);
  }

  return parts.join("; ");
}

export { readWatchlistFile, watchedChannelIds, watchingMessage, watchlistChangeMessage };
