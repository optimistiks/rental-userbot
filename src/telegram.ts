import { TelegramClient } from '@mtcute/node'
import type { FileDownloadLocation, Message } from '@mtcute/node'

import type { LoginSettings, Settings } from './config.js'

export const SESSION_PATH = 'data/session.sqlite'
export const MESSAGE_GROUPING_INTERVAL = 1000

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

const photoLocations = new WeakMap<object, FileDownloadLocation>()

export function createTelegramAdapter(client: TelegramClientLike): Telegram {
  const postHandlers: Array<(post: Post) => void> = []
  let postStreamStarted = false

  function startPostStream(): void {
    if (postStreamStarted) {
      return
    }

    postStreamStarted = true
    client.onNewMessage.add((message) => {
      if (message.isService) {
        return
      }

      const post: Post = {
        chatId: message.chat.id,
        messageIds: [message.id],
        text: message.text,
        photos: [],
        link: message.link,
      }

      for (const handler of postHandlers) {
        handler(post)
      }
    })
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
