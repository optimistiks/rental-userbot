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

function startupMessage(channelIds: readonly number[]): string {
  const count = channelIds.length;
  return `🟢 started, watching ${count} ${count === 1 ? "channel" : "channels"}`;
}

async function announceStartup(
  telegram: Pick<Telegram, "sendToMe">,
  channelIds: readonly number[],
): Promise<void> {
  const message = startupMessage(channelIds);
  console.log(`startup: ${message}`);
  await telegram.sendToMe(message);
}

export { type StartupResources, initializeStartup, startupMessage, announceStartup };
