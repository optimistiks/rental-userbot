import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Settings } from './config.js'
import { initializeStartup } from './startup.js'

const settings = (criteriaPath: string): Settings => ({
  apiId: 123456,
  apiHash: 'hash',
  channelIds: [-1001234567890],
  aiGatewayApiKey: 'gateway-key',
  modelId: 'test/model',
  locationIqToken: 'locationiq-token',
  geocoderUrl: 'http://localhost:1234/search',
  criteriaPath,
  zonePath: 'zone.geojson',
})

describe('initializeStartup', () => {
  it('reads Criteria and initializes a SQLite Dedupe Store', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(criteriaPath, 'Criteria text')

    const resources = initializeStartup(settings(criteriaPath), ':memory:')

    expect(resources.criteria).toBe('Criteria text')
    expect(resources.dedupeStore.isProcessed('chat:1')).toBe(false)
    resources.dedupeStore.close()
  })

  it('fails before opening the database when Criteria cannot be read', () => {
    expect(() => initializeStartup(settings('/missing/criteria.md'), ':memory:')).toThrowError(
      /Criteria file/,
    )
  })
})
