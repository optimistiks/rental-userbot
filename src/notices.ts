import { readTextFile } from "./text-file.js";
import { watchedChannelIds, watchlistChangeMessage } from "./watchlist.js";
import { featureName, readZoneFile } from "./zone.js";

interface NoticePaths {
  channelsPath: string;
  criteriaPath: string;
  promptPath: string;
  zonePath: string;
}

interface NoticePull {
  canEvaluate: boolean;
  notice?: string;
}

interface Notices {
  pull: () => NoticePull;
}

const EVALUATION_FILES = ["criteria", "prompt", "zone"] as const;

/** What each owner-edited file means right now; undefined while a file is unreadable. */
interface Snapshot {
  channelIds: number[];
  criteria: string | undefined;
  prompt: string | undefined;
  zone: string | undefined;
}

function createNotices(paths: NoticePaths): Notices {
  let previous = readSnapshot(paths);

  return {
    pull() {
      const current = readSnapshot(paths);
      const lines = noticeLines(previous, current);
      previous = current;
      for (const line of lines) {
        console.log(`notice: ${line}`);
      }
      return {
        canEvaluate: EVALUATION_FILES.every((file) => current[file] !== undefined),
        ...(lines.length > 0 ? { notice: lines.join("\n") } : {}),
      };
    },
  };
}

function noticeLines(previous: Snapshot, current: Snapshot): string[] {
  const watchlist = watchlistChangeMessage(previous.channelIds, current.channelIds);
  const lines = watchlist === undefined ? [] : [`🟢 watchlist: ${watchlist}`];

  for (const file of EVALUATION_FILES) {
    if (previous[file] !== current[file]) {
      lines.push(current[file] === undefined ? `⚠️ ${file}: not readable` : `🟢 ${file}: updated`);
    }
  }

  return lines;
}

function readSnapshot(paths: NoticePaths): Snapshot {
  return {
    channelIds: watchedChannelIds(paths.channelsPath),
    criteria: tryRead(() => readTextFile(paths.criteriaPath, "Criteria").trim()),
    prompt: tryRead(() => readTextFile(paths.promptPath, "Prompt").trim()),
    zone: tryRead(() => zoneMeaning(paths.zonePath)),
  };
}

function tryRead(read: () => string): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The Zone's shapes and names only, so reformatting the file is not an edit. */
function zoneMeaning(zonePath: string): string {
  return JSON.stringify(
    readZoneFile(zonePath).map((feature) => ({
      coordinates: feature.geometry.coordinates,
      name: featureName(feature),
      type: feature.geometry.type,
    })),
  );
}

export { type Notices, createNotices };
