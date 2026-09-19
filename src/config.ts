type ProcessEnv = NodeJS.ProcessEnv

export const MODEL_ID = 'google/gemini-3.8-flash'
export const GEOCODER_URL = 'https://eu1.locationiq.com/v1/search'
export const CRITERIA_PATH = 'data/criteria.md'
export const PROMPT_PATH = 'data/prompt.md'
export const ZONE_PATH = 'data/zone.geojson'
export const BOT_DATABASE_PATH = 'data/bot.sqlite'

export interface Settings {
  apiId: number
  apiHash: string
  channelIds: number[]
  aiGatewayApiKey: string
  modelId: string
  locationIqToken: string
  geocoderUrl: string
  criteriaPath: string
  promptPath: string
  zonePath: string
}

export interface LoginSettings {
  apiId: number
  apiHash: string
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

function required(env: ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new SettingsError(`${name} is required`)
  }
  return value
}

function positiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new SettingsError(`${name} must be a positive integer`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SettingsError(`${name} must be a positive integer`)
  }
  return parsed
}

function channelIds(value: string): number[] {
  const ids = value.split(',').map((part) => part.trim())
  if (ids.some((id) => !/^-100\d+$/.test(id))) {
    throw new SettingsError('CHANNEL_IDS must be comma-separated marked channel IDs')
  }

  const parsed = ids.map((id) => Number(id))
  if (parsed.some((id) => !Number.isSafeInteger(id))) {
    throw new SettingsError('CHANNEL_IDS contains an unsafe integer')
  }
  return parsed
}

function optional(env: ProcessEnv, name: string, fallback: string): string {
  return env[name]?.trim() || fallback
}

export function readSettings(env: ProcessEnv = process.env): Settings {
  const loginSettings = readLoginSettings(env)

  return {
    ...loginSettings,
    channelIds: channelIds(required(env, 'CHANNEL_IDS')),
    aiGatewayApiKey: required(env, 'AI_GATEWAY_API_KEY'),
    modelId: optional(env, 'MODEL_ID', MODEL_ID),
    locationIqToken: required(env, 'LOCATIONIQ_TOKEN'),
    geocoderUrl: optional(env, 'GEOCODER_URL', GEOCODER_URL),
    criteriaPath: optional(env, 'CRITERIA_PATH', CRITERIA_PATH),
    promptPath: optional(env, 'PROMPT_PATH', PROMPT_PATH),
    zonePath: optional(env, 'ZONE_PATH', ZONE_PATH),
  }
}

export function readLoginSettings(env: ProcessEnv = process.env): LoginSettings {
  return {
    apiId: positiveInteger(required(env, 'API_ID'), 'API_ID'),
    apiHash: required(env, 'API_HASH'),
  }
}
