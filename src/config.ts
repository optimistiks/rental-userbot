type ProcessEnv = NodeJS.ProcessEnv;

const MODEL_ID = "google/gemini-3.8-flash";
const GEOCODER_URL = "https://eu1.locationiq.com/v1/search";
const CRITERIA_PATH = "data/criteria.md";
const PROMPT_PATH = "data/prompt.md";
const ZONE_PATH = "data/zone.geojson";
const BOT_DATABASE_PATH = "data/bot.sqlite";
const MAX_PHOTOS = 6;
const SESSION_LOCK_PATH = "data/session.lock";

interface Settings {
  apiId: number;
  apiHash: string;
  channelIds: number[];
  aiGatewayApiKey: string;
  modelId: string;
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
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

function required(env: ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
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

function channelIds(value: string): number[] {
  const ids = value.split(",").map((part) => part.trim());
  if (ids.some((id) => !/^-100\d+$/u.test(id))) {
    throw new SettingsError("CHANNEL_IDS must be comma-separated marked channel IDs");
  }

  const parsed = ids.map((id) => Number(id));
  if (parsed.some((id) => !Number.isSafeInteger(id))) {
    throw new SettingsError("CHANNEL_IDS contains an unsafe integer");
  }
  return parsed;
}

function optional(env: ProcessEnv, name: string, fallback: string): string {
  return env[name]?.trim() || fallback;
}

function optionalValue(env: ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function readSettings(env: ProcessEnv = process.env): Settings {
  const loginSettings = readLoginSettings(env);
  const sentryDsn = optionalValue(env, "SENTRY_DSN");

  return {
    ...loginSettings,
    aiGatewayApiKey: required(env, "AI_GATEWAY_API_KEY"),
    channelIds: channelIds(required(env, "CHANNEL_IDS")),
    criteriaPath: optional(env, "CRITERIA_PATH", CRITERIA_PATH),
    geocoderUrl: optional(env, "GEOCODER_URL", GEOCODER_URL),
    locationIqToken: required(env, "LOCATIONIQ_TOKEN"),
    modelId: optional(env, "MODEL_ID", MODEL_ID),
    promptPath: optional(env, "PROMPT_PATH", PROMPT_PATH),
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
  GEOCODER_URL,
  CRITERIA_PATH,
  PROMPT_PATH,
  ZONE_PATH,
  BOT_DATABASE_PATH,
  MAX_PHOTOS,
  SESSION_LOCK_PATH,
  type Settings,
  type LoginSettings,
  SettingsError,
  readSettings,
  readLoginSettings,
};
