/* Fixtures shared by the test files; nothing in the bot imports this. */
import type { LanguageModel } from "ai";
import type { MockInstance } from "vitest";

import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTestFinished, vi } from "vitest";

import type { Settings } from "./config.js";
import type { DedupeStore } from "./dedupe-store.js";
import type { Evaluator, EvaluatorOptions } from "./evaluator.js";
import type { Post } from "./telegram.js";

import { openDedupeStore } from "./dedupe-store.js";
import { createEvaluator, createEvaluatorTools } from "./evaluator.js";

const WATCHED_CHANNEL_ID = -1_001_234_567_890;

const usage = {
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 10, total: 10 },
  outputTokens: { reasoning: undefined, text: 5, total: 5 },
};

const UNIT_SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

interface OwnerFiles {
  channelsPath: string;
  criteriaPath: string;
  promptPath: string;
  zonePath: string;
}

/** A Listing from the watched channel: post text and three photos. */
function post(id: number, overrides: Partial<Post> = {}): Post {
  return {
    chatId: WATCHED_CHANNEL_ID,
    link: `https://t.me/example/${id}`,
    messageIds: [id],
    photos: ["photo-1", "photo-2", "photo-3"],
    text: "Flat for rent",
    ...overrides,
  };
}

/** Silences one console method for the rest of the test and returns its spy. */
function quiet(method: "error" | "log" | "warn"): MockInstance {
  const spy = vi.spyOn(console, method).mockImplementation(() => {
    /* Keep test output quiet. */
  });
  onTestFinished(() => {
    spy.mockRestore();
  });
  return spy;
}

function temporaryDirectory(): string {
  return mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
}

function zoneCollection(name: string, ring = UNIT_SQUARE): unknown {
  return {
    features: [
      {
        geometry: { coordinates: [ring], type: "Polygon" },
        properties: { name },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

/** The four owner-edited files, written fresh to their own directory. */
function ownerFiles(channels = "-1001234567890\n"): OwnerFiles {
  const directory = temporaryDirectory();
  const files = {
    channelsPath: path.join(directory, "channels.txt"),
    criteriaPath: path.join(directory, "criteria.md"),
    promptPath: path.join(directory, "prompt.md"),
    zonePath: path.join(directory, "zone.geojson"),
  };
  writeFileSync(files.channelsPath, channels);
  writeFileSync(files.criteriaPath, "Want a 1+1 in Old Town.\n");
  writeFileSync(files.promptPath, "Judge the listing.\n");
  writeFileSync(files.zonePath, JSON.stringify(zoneCollection("Old Batumi")));
  return files;
}

function testSettings(files: OwnerFiles = ownerFiles()): Settings {
  return {
    ...files,
    aiGatewayApiKey: "gateway-key",
    apiHash: "hash",
    apiId: 123_456,
    evaluationConcurrency: 1,
    geocoderUrl: "http://localhost:1234/search",
    locationIqToken: "locationiq-token",
    mediaResolution: "low",
    modelId: "test/model",
    thinkingLevel: "low",
  };
}

/** An in-memory Dedupe Store, closed when the test ends. */
function memoryStore(): DedupeStore {
  const store = openDedupeStore(":memory:");
  onTestFinished(() => {
    store.close();
  });
  return store;
}

/** A model that answers each call with the next Verdict, or always the same one. */
function verdictModel(...verdicts: { match: boolean; notes: string }[]): MockLanguageModelV4 {
  const results = verdicts.map((verdict) => ({
    content: [{ text: JSON.stringify(verdict), type: "text" as const }],
    finishReason: { raw: undefined, unified: "stop" as const },
    usage,
    warnings: [],
  }));
  return new MockLanguageModelV4({ doGenerate: results.length === 1 ? results[0] : results });
}

/** A real Evaluator over fresh owner files, with photo downloads and tools that always work. */
function testEvaluator(
  model: LanguageModel,
  options: Partial<EvaluatorOptions> = {},
  settings: Settings = testSettings(),
): Evaluator {
  return createEvaluator(settings, {
    downloadPhoto: () => Promise.resolve(new Uint8Array([0])),
    model,
    tools: createEvaluatorTools({
      geocode: () => Promise.resolve({ results: [] }),
      inZone: () => ({ inside: false, zone: null }),
    }),
    ...options,
  });
}

export {
  WATCHED_CHANNEL_ID,
  usage,
  type OwnerFiles,
  post,
  quiet,
  temporaryDirectory,
  zoneCollection,
  ownerFiles,
  testSettings,
  memoryStore,
  verdictModel,
  testEvaluator,
};
