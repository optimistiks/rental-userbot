type ProcessEnv = NodeJS.ProcessEnv;

const MODEL_ID = "google/gemini-3.8-flash";
const MEDIA_RESOLUTION = "low";
const THINKING_LEVEL = "low";
const GEOCODER_URL = "https://eu1.locationiq.com/v1/search";
const CHANNELS_PATH = "data/channels.txt";
const CRITERIA_PATH = "data/criteria.md";
const PROMPT_PATH = "data/prompt.md";
const ZONE_PATH = "data/zone.geojson";
const BOT_DATABASE_PATH = "data/bot.sqlite";
const MAX_PHOTOS = 6;
const MIN_LISTING_PHOTOS = 3;
const SESSION_LOCK_PATH = "data/session.lock";

const MEDIA_RESOLUTIONS = ["low", "medium", "high"] as const;
const THINKING_LEVELS = ["low", "medium", "high"] as const;

type MediaResolution = (typeof MEDIA_RESOLUTIONS)[number];
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

interface Settings {
  apiId: number;
  apiHash: string;
  channelsPath: string;
  aiGatewayApiKey: string;
  modelId: string;
  mediaResolution: MediaResolution;
  thinkingLevel: ThinkingLevel;
  locationIqToken: string;
  geocoderUrl: string;
  criteriaPath: string;
  promptPath: string;
  zonePath: string;
  sentryDsn?: string;
}

interface LoginSettings {
  apiId: number;
  apiHash: string;
}

class SettingsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

function required(env: ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new SettingsError(`${name} is required`);
  }
  return value;
}

function positiveInteger(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new SettingsError(`${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SettingsError(`${name} must be a positive integer`);
  }
  return parsed;
}

function optional(env: ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? fallback : value;
}

function optionalValue(env: ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function optionalChoice<const T extends string>(
  env: ProcessEnv,
  name: string,
  fallback: T,
  choices: readonly T[],
): T {
  const value = optional(env, name, fallback);
  if (!isChoice(value, choices)) {
    throw new SettingsError(`${name} must be one of: ${choices.join(", ")}`);
  }
  return value;
}

function isChoice<T extends string>(value: string, choices: readonly T[]): value is T {
  return choices.some((choice) => choice === value);
}

function readSettings(env: ProcessEnv = process.env): Settings {
  const loginSettings = readLoginSettings(env);
  const sentryDsn = optionalValue(env, "SENTRY_DSN");

  return {
    ...loginSettings,
    aiGatewayApiKey: required(env, "AI_GATEWAY_API_KEY"),
    channelsPath: optional(env, "CHANNELS_PATH", CHANNELS_PATH),
    criteriaPath: optional(env, "CRITERIA_PATH", CRITERIA_PATH),
    geocoderUrl: optional(env, "GEOCODER_URL", GEOCODER_URL),
    locationIqToken: required(env, "LOCATIONIQ_TOKEN"),
    mediaResolution: optionalChoice(env, "MEDIA_RESOLUTION", MEDIA_RESOLUTION, MEDIA_RESOLUTIONS),
    modelId: optional(env, "MODEL_ID", MODEL_ID),
    promptPath: optional(env, "PROMPT_PATH", PROMPT_PATH),
    thinkingLevel: optionalChoice(env, "THINKING_LEVEL", THINKING_LEVEL, THINKING_LEVELS),
    zonePath: optional(env, "ZONE_PATH", ZONE_PATH),
    ...(sentryDsn === undefined ? {} : { sentryDsn }),
  };
}

function readLoginSettings(env: ProcessEnv = process.env): LoginSettings {
  return {
    apiHash: required(env, "API_HASH"),
    apiId: positiveInteger(required(env, "API_ID"), "API_ID"),
  };
}

export {
  MODEL_ID,
  MEDIA_RESOLUTION,
  THINKING_LEVEL,
  GEOCODER_URL,
  CHANNELS_PATH,
  CRITERIA_PATH,
  PROMPT_PATH,
  ZONE_PATH,
  BOT_DATABASE_PATH,
  MAX_PHOTOS,
  MIN_LISTING_PHOTOS,
  SESSION_LOCK_PATH,
  type MediaResolution,
  type ThinkingLevel,
  type Settings,
  type LoginSettings,
  SettingsError,
  readSettings,
  readLoginSettings,
};
