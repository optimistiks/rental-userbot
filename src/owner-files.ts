import { readFileSync } from "node:fs";

import type { Zone } from "./zone.js";

import { errorMessage } from "./errors.js";
import { parseWatchlist, watchlistChangeMessage } from "./watchlist.js";
import { featureName, parseZone } from "./zone.js";

interface OwnerFilePaths {
  channelsPath: string;
  criteriaPath: string;
  promptPath: string;
  zonePath: string;
}

/** What a Listing is judged by: the Owner files as they read when its Post arrived. */
interface OwnerFileContents {
  criteria: string;
  prompt: string;
  zone: Zone;
}

interface OwnerFilesRead {
  /** Set when an Owner file changed meaning since the previous read. */
  notice?: string;
  /** Missing while the Criteria, Prompt or Zone is unreadable: no Listing is judged until it reads again. */
  contents?: OwnerFileContents;
}

interface OwnerFiles {
  /** How many channels the Watchlist held when the bot started. */
  watchedAtStartup: number;
  /** Re-read on every call; a Watchlist that cannot be read means watching nothing. */
  watchedChannelIds: () => number[];
  /** Once per Post, when it arrives. */
  read: () => OwnerFilesRead;
}

const EVALUATION_FILES = ["criteria", "prompt", "zone"] as const;

/** What each Owner file means right now; null while a file is unreadable. */
interface Snapshot {
  channelIds: number[];
  criteria: string | null;
  prompt: string | null;
  zone: { value: Zone; meaning: string } | null;
}

type Attempt = <T>(read: () => T) => T | null;

const strictly: Attempt = (read) => read();

const leniently: Attempt = (read) => {
  try {
    return read();
  } catch {
    return null;
  }
};

/**
 * Throws a named error if any Owner file is missing or malformed: at startup that
 * means the setup was never finished. Once running, the same file vanishing is
 * a Notice, not a crash.
 */
function openOwnerFiles(paths: OwnerFilePaths): OwnerFiles {
  let previous = readSnapshot(paths, strictly);
  const watchedAtStartup = previous.channelIds.length;

  return {
    read() {
      const current = readSnapshot(paths, leniently);
      const lines = noticeLines(previous, current);
      previous = current;
      for (const line of lines) {
        console.log(`notice: ${line}`);
      }

      const { criteria, prompt, zone } = current;
      return {
        ...(lines.length > 0 ? { notice: lines.join("\n") } : {}),
        ...(criteria === null || prompt === null || zone === null
          ? {}
          : { contents: { criteria, prompt, zone: zone.value } }),
      };
    },
    watchedAtStartup,
    watchedChannelIds: () => leniently(() => readWatchlist(paths)) ?? [],
  };
}

function readSnapshot(paths: OwnerFilePaths, attempt: Attempt): Snapshot {
  return {
    channelIds: attempt(() => readWatchlist(paths)) ?? [],
    criteria: attempt(() => readOwnerFile(paths.criteriaPath, "Criteria", (text) => text.trim())),
    prompt: attempt(() => readOwnerFile(paths.promptPath, "Prompt", (text) => text.trim())),
    zone: attempt(() =>
      readOwnerFile(paths.zonePath, "Zone", (text) => {
        const value = parseZone(text);
        return { meaning: zoneMeaning(value), value };
      }),
    ),
  };
}

function readWatchlist(paths: OwnerFilePaths): number[] {
  return readOwnerFile(paths.channelsPath, "Watchlist", parseWatchlist);
}

function readOwnerFile<T>(path: string, label: string, parse: (text: string) => T): T {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${label} file "${path}" is not readable: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  try {
    return parse(text);
  } catch (error) {
    throw new Error(`${label} file "${path}" ${errorMessage(error)}`, { cause: error });
  }
}

/** A change is meaning, not bytes: the channel-ID set, the trimmed text, the Zone's shapes and names. */
function noticeLines(previous: Snapshot, current: Snapshot): string[] {
  const watchlist = watchlistChangeMessage(previous.channelIds, current.channelIds);
  const lines = watchlist === undefined ? [] : [`🟢 watchlist: ${watchlist}`];

  for (const file of EVALUATION_FILES) {
    if (meaning(previous, file) !== meaning(current, file)) {
      lines.push(current[file] === null ? `⚠️ ${file}: not readable` : `🟢 ${file}: updated`);
    }
  }

  return lines;
}

function meaning(snapshot: Snapshot, file: (typeof EVALUATION_FILES)[number]): string | null {
  return file === "zone" ? (snapshot.zone?.meaning ?? null) : snapshot[file];
}

/** The Zone's shapes and names only, so reformatting the file is not an edit. */
function zoneMeaning(zone: Zone): string {
  return JSON.stringify(
    zone.map((feature) => ({
      coordinates: feature.geometry.coordinates,
      name: featureName(feature),
      type: feature.geometry.type,
    })),
  );
}

export {
  type OwnerFilePaths,
  type OwnerFileContents,
  type OwnerFilesRead,
  type OwnerFiles,
  openOwnerFiles,
};
