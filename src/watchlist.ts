const MARKED_CHANNEL_ID = /^-100\d+$/u;

/** A line counts only if it is a marked channel ID; anything else is the owner's own note. */
function parseWatchlist(text: string): number[] {
  const ids = text
    .split("\n")
    .map((line) => line.split("#", 1)[0].trim())
    .filter((candidate) => MARKED_CHANNEL_ID.test(candidate))
    .map(Number)
    .filter((id) => Number.isSafeInteger(id));
  return [...new Set(ids)];
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

export { parseWatchlist, watchingMessage, watchlistChangeMessage };
