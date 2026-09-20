import { networkMiddlewares, TelegramClient } from '@mtcute/node'
import type { FileDownloadLocation, Message } from '@mtcute/node'

import { MAX_PHOTOS, type LoginSettings, type Settings } from './config.js'

export const SESSION_PATH = 'data/session.sqlite'
export const MESSAGE_GROUPING_INTERVAL = 1000

/**
 * Telegram answers a flood wait with "back off for N seconds". mtcute sleeps
 * through waits up to 10s by default and throws above that; the process would
 * then die mid-flood. Sleeping through waits up to 5 minutes obeys Telegram
 * instead of arguing with it.
 */
export const MAX_FLOOD_WAIT_MS = 300_000
export const MAX_FLOOD_RETRIES = 3

/** Pinned so an mtcute upgrade doesn't silently change how this session is listed under Telegram's Devices. */
export const DEVICE_INFO = {
  deviceModel: 'rental-userbot',
  systemVersion: 'docker',
  appVersion: '0.1.0',
} as const

export interface PhotoRef {
  readonly __photoRef: true
}

export interface Post {
  chatId: number
  messageIds: number[]
  albumId?: string
  text: string
  photos: PhotoRef[]
  link: string
}

export interface Telegram {
  onPost(handler: (post: Post) => void): void
  downloadPhoto(ref: PhotoRef): Promise<Uint8Array>
  sendToMe(text: string): Promise<void>
  joinedChannelIds(): Promise<number[]>
}

interface DialogPeer {
  type?: string
  chatType?: string
  id: number
}

interface DialogLike {
  peer?: DialogPeer
  chat?: DialogPeer
}

interface MessageEmitter<T> {
  add(listener: (value: T) => void): void
}

export interface TelegramClientLike {
  onNewMessage: MessageEmitter<Message>
  onMessageGroup: MessageEmitter<Message[]>
  sendText(
    chatId: 'me',
    text: string,
    params: { disableWebPreview: true },
  ): Promise<unknown>
  iterDialogs(params: { archived: 'keep' }): AsyncIterable<DialogLike>
  downloadAsBuffer(location: FileDownloadLocation): Promise<Uint8Array>
}

type TelegramClientOptions = ConstructorParameters<typeof TelegramClient>[0]

export function telegramClientOptions(
  settings: Pick<LoginSettings, 'apiId' | 'apiHash'>,
): TelegramClientOptions {
  return {
    apiId: settings.apiId,
    apiHash: settings.apiHash,
    storage: SESSION_PATH,
    initConnectionOptions: DEVICE_INFO,
    network: {
      middlewares: networkMiddlewares.basic({
        floodWaiter: { maxWait: MAX_FLOOD_WAIT_MS, maxRetries: MAX_FLOOD_RETRIES },
      }),
    },
    updates: {
      catchUp: false,
      messageGroupingInterval: MESSAGE_GROUPING_INTERVAL,
    },
  }
}

export function createTelegramClient(
  settings: Pick<Settings, 'apiId' | 'apiHash'>,
): TelegramClient {
  return new TelegramClient(telegramClientOptions(settings))
}

export const daemonStartParams = {
  phone: async (): Promise<string> => {
    throw new Error('run login first')
  },
  code: async (): Promise<string> => {
    throw new Error('run login first')
  },
  password: async (): Promise<string> => {
    throw new Error('run login first')
  },
}

export type SessionClient = {
  start(params?: typeof daemonStartParams): Promise<unknown>
}

export async function startDaemonSession(client: SessionClient): Promise<void> {
  await client.start(daemonStartParams)
}


export function createTelegramAdapter(client: TelegramClientLike): Telegram {
  const postHandlers: Array<(post: Post) => void> = []
  const photoLocations = new WeakMap<object, FileDownloadLocation>()
  let postStreamStarted = false

  function startPostStream(): void {
    if (postStreamStarted) {
      return
    }

    postStreamStarted = true
    client.onNewMessage.add((message) => emitPost([message]))
    client.onMessageGroup.add((messages) => emitPost(messages))
  }

  function emitPost(messages: readonly Message[]): void {
    const postMessages = messages
      .filter((message) => !message.isService)
      .sort((left, right) => left.id - right.id)

    if (postMessages.length === 0) {
      return
    }

    const firstMessage = postMessages[0]
    const albumId = firstMessage.groupedIdUnique
    const post: Post = {
      chatId: firstMessage.chat.id,
      messageIds: postMessages.map((message) => message.id),
      text: postMessages
        .map((message) => message.text)
        .filter((text) => text !== '')
        .join('\n\n'),
      photos: postMessages.flatMap((message) => photoRefFor(message)).slice(0, MAX_PHOTOS),
      link: firstMessage.link,
      ...(albumId == null ? {} : { albumId }),
    }

    for (const handler of postHandlers) {
      handler(post)
    }
  }

  function photoRefFor(message: Message): PhotoRef[] {
    const media = message.media
    if (media?.type !== 'photo') {
      return []
    }

    const location = media.getThumbnail('y') ?? media.getThumbnail('x') ?? media
    const ref = { __photoRef: true } as const
    photoLocations.set(ref, location)
    return [ref]
  }

  return {
    onPost(handler) {
      postHandlers.push(handler)
      startPostStream()
    },
    async downloadPhoto(ref) {
      const location = photoLocations.get(ref)
      if (location === undefined) {
        throw new Error('Unknown Telegram photo reference')
      }
      return client.downloadAsBuffer(location)
    },
    async sendToMe(text) {
      await client.sendText('me', text, { disableWebPreview: true })
    },
    async joinedChannelIds() {
      const channelIds: number[] = []
      const seen = new Set<number>()

      for await (const dialog of client.iterDialogs({ archived: 'keep' })) {
        const peer = dialog.peer ?? dialog.chat
        if (peer === undefined || !isChannel(peer) || seen.has(peer.id)) {
          continue
        }

        seen.add(peer.id)
        channelIds.push(peer.id)
      }

      return channelIds
    },
  }
}

function isChannel(peer: DialogPeer): boolean {
  return (
    peer.type === 'channel' ||
    peer.chatType === 'channel' ||
    peer.chatType === 'gigagroup'
  )
}
