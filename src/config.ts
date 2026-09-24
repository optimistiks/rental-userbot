type ProcessEnv = NodeJS.ProcessEnv;

const BOT_DATABASE_PATH = "data/bot.sqlite";
const SESSION_LOCK_PATH = "data/session.lock";

const LEVELS = ["low", "medium", "high"] as const;

type Level = (typeof LEVELS)[number];

interface Settings {
  apiId: number;
  apiHash: string;
  channelsPath: string;
  aiGatewayApiKey: string;
  modelId: string;
  mediaResolution: Level;
  thinkingLevel: Level;
  evaluationConcurrency: number;
  locationIqToken: string;
  geocoderUrl: string;
  criteriaPath: string;
  promptPath: string;
  zonePath: string;
}

type LoginSettings = Pick<Settings, "apiId" | "apiHash">;

function optional(env: ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === "" ? undefined : value;
}

function required(env: ProcessEnv, name: string): string {
  const value = optional(env, name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function level(env: ProcessEnv, name: string): Level {
  const value = optional(env, name) ?? "low";
  const match = LEVELS.find((choice) => choice === value);
  if (match === undefined) {
    throw new Error(`${name} must be one of: ${LEVELS.join(", ")}`);
  }
  return match;
}

function readSettings(env: ProcessEnv = process.env): Settings {
  return {
    ...readLoginSettings(env),
    aiGatewayApiKey: required(env, "AI_GATEWAY_API_KEY"),
    channelsPath: optional(env, "CHANNELS_PATH") ?? "data/channels.txt",
    criteriaPath: optional(env, "CRITERIA_PATH") ?? "data/criteria.md",
    evaluationConcurrency: positiveInteger(
      optional(env, "EVALUATION_CONCURRENCY") ?? "3",
      "EVALUATION_CONCURRENCY",
    ),
    geocoderUrl: optional(env, "GEOCODER_URL") ?? "https://eu1.locationiq.com/v1/search",
    locationIqToken: required(env, "LOCATIONIQ_TOKEN"),
    mediaResolution: level(env, "MEDIA_RESOLUTION"),
    modelId: optional(env, "MODEL_ID") ?? "google/gemini-3.8-flash",
    promptPath: optional(env, "PROMPT_PATH") ?? "data/prompt.md",
    thinkingLevel: level(env, "THINKING_LEVEL"),
    zonePath: optional(env, "ZONE_PATH") ?? "data/zone.geojson",
  };
}

function readLoginSettings(env: ProcessEnv = process.env): LoginSettings {
  return {
    apiHash: required(env, "API_HASH"),
    apiId: positiveInteger(required(env, "API_ID"), "API_ID"),
  };
}

export {
  BOT_DATABASE_PATH,
  SESSION_LOCK_PATH,
  type Level,
  type Settings,
  type LoginSettings,
  readSettings,
  readLoginSettings,
};
