import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { Settings } from './config.js'
import { announceStartup, initializeStartup } from './startup.js'

const settings = (criteriaPath: string, promptPath = criteriaPath): Settings => ({
  apiId: 123456,
  apiHash: 'hash',
  channelIds: [-1001234567890],
  aiGatewayApiKey: 'gateway-key',
  modelId: 'test/model',
  locationIqToken: 'locationiq-token',
  geocoderUrl: 'http://localhost:1234/search',
  criteriaPath,
  promptPath,
  zonePath: 'zone.geojson',
})

describe('initializeStartup', () => {
  it('reads Criteria and initializes a SQLite Dedupe Store', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(criteriaPath, 'Criteria text')

    const resources = initializeStartup(settings(criteriaPath), ':memory:')

    expect(resources.criteria).toBe('Criteria text')
    expect(resources.prompt).toBe('Criteria text')
    expect(resources.dedupeStore.isProcessed('chat:1')).toBe(false)
    resources.dedupeStore.close()
  })

  it('fails before opening the database when Criteria cannot be read', () => {
    expect(() => initializeStartup(settings('/missing/criteria.md'), ':memory:')).toThrowError(
      /Criteria file/,
    )
  })

  it('names the Prompt file when it cannot be read', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const criteriaPath = join(directory, 'criteria.md')
    const promptPath = join(directory, 'prompt.md')
    writeFileSync(criteriaPath, 'Criteria text')

    expect(() => initializeStartup(settings(criteriaPath, promptPath), ':memory:')).toThrowError(
      new RegExp(`Prompt file .*${promptPath}`),
    )
  })
})

describe('announceStartup', () => {
  it('sends the startup message and reports missing channels', async () => {
    const telegram = {
      joinedChannelIds: vi.fn(async () => [-1001234567890]),
      sendToMe: vi.fn(async () => undefined),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await announceStartup(telegram, [-1001234567890, -1009876543210])

    expect(warn).toHaveBeenCalledWith('channel not joined: -1009876543210')
    expect(log).toHaveBeenCalledWith(
      'startup: 🟢 started, watching 1/2 channels; not joined: -1009876543210',
    )
    expect(telegram.sendToMe).toHaveBeenCalledWith(
      '🟢 started, watching 1/2 channels\nnot joined: -1009876543210',
    )

    warn.mockRestore()
    log.mockRestore()
  })

  it('omits the not-joined line when every channel is joined', async () => {
    const telegram = {
      joinedChannelIds: vi.fn(async () => [-1001234567890]),
      sendToMe: vi.fn(async () => undefined),
    }

    await announceStartup(telegram, [-1001234567890])

    expect(telegram.sendToMe).toHaveBeenCalledWith(
      '🟢 started, watching 1/1 channels',
    )
  })
})
