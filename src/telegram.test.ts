import { describe, expect, it, vi } from 'vitest'

import type { Settings } from './config.js'
import {
  daemonStartParams,
  createTelegramAdapter,
  telegramClientOptions,
  startDaemonSession,
} from './telegram.js'

const settings = {
  apiId: 123456,
  apiHash: 'hash',
} satisfies Pick<Settings, 'apiId' | 'apiHash'>

describe('telegram client setup', () => {
  it('uses the persistent session and the specified update settings', () => {
    expect(telegramClientOptions(settings)).toEqual({
      apiId: 123456,
      apiHash: 'hash',
      storage: 'data/session.sqlite',
      updates: {
        catchUp: false,
        messageGroupingInterval: 1000,
      },
    })
  })

  it('refuses interactive prompts when starting the daemon', async () => {
    const start = vi.fn(async (params: typeof daemonStartParams) => {
      await params.phone?.()
    })

    await expect(startDaemonSession({ start })).rejects.toThrow('run login first')
    expect(start).toHaveBeenCalledWith(daemonStartParams)
  })
})

describe('Telegram adapter', () => {
  it('sends to Saved Messages with link previews disabled', async () => {
    const sendText = vi.fn(async () => undefined)
    const client = {
      sendText,
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
    }
    const telegram = createTelegramAdapter(client)

    await telegram.sendToMe('https://t.me/example/1\nLooks good')

    expect(sendText).toHaveBeenCalledWith(
      'me',
      'https://t.me/example/1\nLooks good',
      { disableWebPreview: true },
    )
  })

  it('lists marked IDs for joined channels, including archived dialogs', async () => {
    const iterDialogs = vi.fn(async function* () {
      yield { peer: { type: 'chat', chatType: 'channel', id: -1001234567890 } }
      yield { peer: { type: 'chat', chatType: 'supergroup', id: -1002222222222 } }
      yield { peer: { type: 'chat', chatType: 'channel', id: -1009876543210 } }
    })
    const client = {
      sendText: vi.fn(),
      iterDialogs,
      downloadAsBuffer: vi.fn(),
    }
    const telegram = createTelegramAdapter(client)

    await expect(telegram.joinedChannelIds()).resolves.toEqual([
      -1001234567890,
      -1009876543210,
    ])
    expect(iterDialogs).toHaveBeenCalledWith({ archived: 'keep' })
  })
})
