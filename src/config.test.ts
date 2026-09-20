import { describe, expect, it } from 'vitest'

import {
  CRITERIA_PATH,
  GEOCODER_URL,
  MODEL_ID,
  PROMPT_PATH,
  readLoginSettings,
  readSettings,
  ZONE_PATH,
} from './config.js'

const validEnvironment = {
  API_ID: '123456',
  API_HASH: 'hash',
  CHANNEL_IDS: '-1001234567890, -1009876543210',
  AI_GATEWAY_API_KEY: 'gateway-key',
  LOCATIONIQ_TOKEN: 'locationiq-token',
}

describe('readSettings', () => {
  it('reads only the API settings needed by login', () => {
    expect(
      readLoginSettings({
        API_ID: '123456',
        API_HASH: 'hash',
      }),
    ).toEqual({ apiId: 123456, apiHash: 'hash' })
  })

  it('reads required settings, parses marked channel IDs, and applies defaults', () => {
    expect(readSettings(validEnvironment)).toEqual({
      apiId: 123456,
      apiHash: 'hash',
      channelIds: [-1001234567890, -1009876543210],
      aiGatewayApiKey: 'gateway-key',
      modelId: MODEL_ID,
      locationIqToken: 'locationiq-token',
      geocoderUrl: GEOCODER_URL,
      criteriaPath: CRITERIA_PATH,
      promptPath: PROMPT_PATH,
      zonePath: ZONE_PATH,
    })
  })

  it('allows optional settings to override defaults', () => {
    expect(
      readSettings({
        ...validEnvironment,
        MODEL_ID: 'test/model',
        GEOCODER_URL: 'http://localhost:1234/search',
        CRITERIA_PATH: '/tmp/criteria.md',
        PROMPT_PATH: '/tmp/prompt.md',
        ZONE_PATH: '/tmp/zone.geojson',
      }),
    ).toMatchObject({
      modelId: 'test/model',
      geocoderUrl: 'http://localhost:1234/search',
      criteriaPath: '/tmp/criteria.md',
      promptPath: '/tmp/prompt.md',
      zonePath: '/tmp/zone.geojson',
    })
  })

  it('keeps Sentry disabled unless SENTRY_DSN is set', () => {
    expect(readSettings(validEnvironment).sentryDsn).toBeUndefined()
    expect(readSettings({ ...validEnvironment, SENTRY_DSN: 'https://public@example.com/1' }).sentryDsn)
      .toBe('https://public@example.com/1')
  })

  it.each([
    'API_ID',
    'API_HASH',
    'CHANNEL_IDS',
    'AI_GATEWAY_API_KEY',
    'LOCATIONIQ_TOKEN',
  ])('names missing required setting %s', (name) => {
    const environment = { ...validEnvironment }
    delete environment[name as keyof typeof environment]

    expect(() => readSettings(environment)).toThrowError(
      new RegExp(`${name} is required`),
    )
  })

  it('rejects malformed API_ID', () => {
    expect(() => readSettings({ ...validEnvironment, API_ID: 'not-a-number' })).toThrowError(
      new RegExp('API_ID'),
    )
  })

  it('rejects unmarked channel IDs', () => {
    expect(() => readSettings({ ...validEnvironment, CHANNEL_IDS: '12345' })).toThrowError(
      new RegExp('CHANNEL_IDS'),
    )
  })
})
