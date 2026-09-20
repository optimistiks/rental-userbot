import type { ZoneFile } from "./zone.js";

import { readCriteriaFile, readPromptFile } from "./text-file.js";
import { readWatchlistFile, watchlistChangeMessage } from "./watchlist.js";
import { readZoneFile } from "./zone.js";

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

type FileState = { kind: "ok"; value: string } | { kind: "unreadable" };

interface Snapshot {
  channelIds: number[];
  criteria: FileState;
  prompt: FileState;
  zone: FileState;
}

function createNotices(paths: NoticePaths): Notices {
  let previous = readSnapshot(paths);

  return {
    pull() {
      const current = readSnapshot(paths);
      const lines = noticeLines(previous, current);
      previous = current;
      return {
        canEvaluate: canEvaluate(current),
        ...(lines.length > 0 ? { notice: lines.join("\n") } : {}),
      };
    },
  };
}

function canEvaluate(snapshot: Snapshot): boolean {
  return (
    snapshot.criteria.kind === "ok" && snapshot.prompt.kind === "ok" && snapshot.zone.kind === "ok"
  );
}

function noticeLines(previous: Snapshot, current: Snapshot): string[] {
  const lines: string[] = [];
  const watchlist = watchlistChangeMessage(previous.channelIds, current.channelIds);
  if (watchlist !== undefined) {
    lines.push(`🟢 watchlist: ${watchlist}`);
  }

  const criteria = fileNotice("criteria", previous.criteria, current.criteria);
  if (criteria !== undefined) {
    lines.push(criteria);
  }

  const prompt = fileNotice("prompt", previous.prompt, current.prompt);
  if (prompt !== undefined) {
    lines.push(prompt);
  }

  const zone = fileNotice("zone", previous.zone, current.zone);
  if (zone !== undefined) {
    lines.push(zone);
  }

  return lines;
}

function fileNotice(label: string, previous: FileState, current: FileState): string | undefined {
  if (statesEqual(previous, current)) {
    return undefined;
  }

  if (current.kind === "unreadable") {
    return `⚠️ ${label}: not readable`;
  }

  return `🟢 ${label}: updated`;
}

function statesEqual(left: FileState, right: FileState): boolean {
  if (left.kind === "unreadable" && right.kind === "unreadable") {
    return true;
  }

  return left.kind === "ok" && right.kind === "ok" && left.value === right.value;
}

function readSnapshot(paths: NoticePaths): Snapshot {
  return {
    channelIds: readChannelIds(paths.channelsPath),
    criteria: readTextState(() => readCriteriaFile(paths.criteriaPath)),
    prompt: readTextState(() => readPromptFile(paths.promptPath)),
    zone: readZoneState(paths.zonePath),
  };
}

function readChannelIds(channelsPath: string): number[] {
  try {
    return readWatchlistFile(channelsPath);
  } catch {
    return [];
  }
}

function readTextState(read: () => string): FileState {
  try {
    return { kind: "ok", value: read().trim() };
  } catch {
    return { kind: "unreadable" };
  }
}

function readZoneState(zonePath: string): FileState {
  try {
    return { kind: "ok", value: zoneMeaning(readZoneFile(zonePath)) };
  } catch {
    return { kind: "unreadable" };
  }
}

function zoneMeaning(zone: ZoneFile): string {
  return JSON.stringify(
    zone.features.map((feature) => ({
      coordinates: feature.geometry.coordinates,
      name: typeof feature.properties?.name === "string" ? feature.properties.name : null,
      type: feature.geometry.type,
    })),
  );
}

export { type NoticePaths, type NoticePull, type Notices, createNotices };
