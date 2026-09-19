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
  it('starts the Post stream when a handler is registered', () => {
    const onNewMessage = { add: vi.fn() }
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
    }
    const telegram = createTelegramAdapter(client)
    const handler = vi.fn()

    telegram.onPost(handler)

    expect(onNewMessage.add).toHaveBeenCalledOnce()
  })

  it('turns a non-service message into a text-only Post', () => {
    const onNewMessage = { add: vi.fn() }
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
    }
    const telegram = createTelegramAdapter(client)
    const handler = vi.fn()
    telegram.onPost(handler)
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0]

    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 42,
      isService: false,
      link: 'https://t.me/example/42',
      text: 'Flat for rent',
    })

    expect(handler).toHaveBeenCalledWith({
      chatId: -1001234567890,
      messageIds: [42],
      text: 'Flat for rent',
      photos: [],
      link: 'https://t.me/example/42',
    })
  })

  it('does not emit service messages', () => {
    const onNewMessage = { add: vi.fn() }
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
    }
    const telegram = createTelegramAdapter(client)
    const handler = vi.fn()
    telegram.onPost(handler)
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0]

    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 43,
      isService: true,
      link: 'https://t.me/example/43',
      text: '',
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('sends to Saved Messages with link previews disabled', async () => {
    const sendText = vi.fn(async () => undefined)
    const client = {
      sendText,
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage: { add: vi.fn() },
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
      onNewMessage: { add: vi.fn() },
    }
    const telegram = createTelegramAdapter(client)

    await expect(telegram.joinedChannelIds()).resolves.toEqual([
      -1001234567890,
      -1009876543210,
    ])
    expect(iterDialogs).toHaveBeenCalledWith({ archived: 'keep' })
  })
})
