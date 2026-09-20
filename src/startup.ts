import type { Settings } from "./config.js";
import type { DedupeStore } from "./dedupe-store.js";
import type { Telegram } from "./telegram.js";

import { openDedupeStore } from "./dedupe-store.js";
import { readCriteriaFile, readPromptFile } from "./text-file.js";
import { readWatchlistFile } from "./watchlist.js";
import { readZoneFile } from "./zone.js";

interface StartupResources {
  dedupeStore: DedupeStore;
}

function initializeStartup(settings: Settings, databasePath?: string): StartupResources {
  // Read-and-discard: every one of these is re-read while the bot runs, so this is
  // Only the startup check that they exist and parse. A watchlist missing here means
  // The setup was never finished; one that vanishes later just means watching nothing.
  readCriteriaFile(settings.criteriaPath);
  readPromptFile(settings.promptPath);
  readZoneFile(settings.zonePath);
  readWatchlistFile(settings.channelsPath);
  return { dedupeStore: openDedupeStore(databasePath) };
}

function unjoinedChannelIds(
  channelIds: readonly number[],
  joinedChannelIds: readonly number[],
): number[] {
  const joined = new Set(joinedChannelIds);
  return channelIds.filter((channelId) => !joined.has(channelId));
}

function startupMessage(channelIds: number[], joinedChannelIds: number[]): string {
  const missing = unjoinedChannelIds(channelIds, joinedChannelIds);
  const lines = [
    `🟢 started, watching ${channelIds.length - missing.length}/${channelIds.length} channels`,
  ];

  if (missing.length > 0) {
    lines.push(`not joined: ${missing.join(", ")}`);
  }

  return lines.join("\n");
}

async function announceStartup(
  telegram: Pick<Telegram, "joinedChannelIds" | "sendToMe">,
  channelIds: number[],
): Promise<void> {
  // Best-effort: the membership check is a warning, so a flood wait or a failed
  // Dialog scan must not take the bot down with it.
  let joinedChannelIds: number[] | undefined;
  try {
    joinedChannelIds = await telegram.joinedChannelIds();
  } catch (error) {
    console.warn("could not check channel membership", error);
  }

  const message =
    joinedChannelIds === undefined
      ? `🟢 started, watching ${channelIds.length} channels\nmembership not checked`
      : startupMessage(channelIds, joinedChannelIds);

  for (const channelId of unjoinedChannelIds(channelIds, joinedChannelIds ?? channelIds)) {
    console.warn(`channel not joined: ${channelId}`);
  }

  console.log(`startup: ${message.replace("\n", "; ")}`);
  await telegram.sendToMe(message);
}

export {
  type StartupResources,
  initializeStartup,
  unjoinedChannelIds,
  startupMessage,
  announceStartup,
};
