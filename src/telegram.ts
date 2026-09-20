import type { FileDownloadLocation, Message } from "@mtcute/node";

import { TelegramClient, networkMiddlewares } from "@mtcute/node";

import type { LoginSettings, Settings } from "./config.js";

import { MAX_PHOTOS } from "./config.js";

const SESSION_PATH = "data/session.sqlite";
const MESSAGE_GROUPING_INTERVAL = 1000;

/**
 * Stamped on every write to Saved Messages so the owner can filter what the bot
 * wrote out of a chat they also use by hand. Telegram ends a hashtag at the
 * first character that is not a letter, digit or underscore, so a hyphen here
 * would post as the hashtag "#rental" and the plain text "-userbot".
 */
const SAVED_MESSAGES_TAG = "#rental_userbot";
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

/**
 * Telegram answers a flood wait with "back off for N seconds". mtcute sleeps
 * through waits up to 10s by default and throws above that; the process would
 * then die mid-flood. Sleeping through waits up to 5 minutes obeys Telegram
 * instead of arguing with it.
 */
const MAX_FLOOD_WAIT_MS = 300_000;
const MAX_FLOOD_RETRIES = 3;

/** Pinned so an mtcute upgrade doesn't silently change how this session is listed under Telegram's Devices. */
const DEVICE_INFO = {
  appVersion: "0.1.0",
  deviceModel: "rental-userbot",
  systemVersion: "docker",
} as const;

interface PhotoRef {
  readonly __photoRef: true;
}

interface Post {
  chatId: number;
  messageIds: number[];
  albumId?: string;
  text: string;
  photos: PhotoRef[];
  link: string;
}

interface Telegram {
  onPost: (handler: (post: Post) => void) => void;
  downloadPhoto: (ref: PhotoRef) => Promise<Uint8Array>;
  sendToMe: (text: string) => Promise<void>;
  joinedChannelIds: () => Promise<number[]>;
}

interface DialogPeer {
  type?: string;
  chatType?: string;
  id: number;
}

interface DialogLike {
  peer?: DialogPeer;
  chat?: DialogPeer;
}

interface MessageEmitter<T> {
  add: (listener: (value: T) => void) => void;
}

interface TelegramClientLike {
  onNewMessage: MessageEmitter<Message>;
  onMessageGroup: MessageEmitter<Message[]>;
  sendText: (chatId: "me", text: string, params: { disableWebPreview: true }) => Promise<unknown>;
  iterDialogs: (params: { archived: "keep" }) => AsyncIterable<DialogLike>;
  downloadAsBuffer: (location: FileDownloadLocation) => Promise<Uint8Array>;
}

type TelegramClientOptions = ConstructorParameters<typeof TelegramClient>[0];

function telegramClientOptions(
  settings: Pick<LoginSettings, "apiId" | "apiHash">,
): TelegramClientOptions {
  return {
    apiHash: settings.apiHash,
    apiId: settings.apiId,
    initConnectionOptions: DEVICE_INFO,
    network: {
      middlewares: networkMiddlewares.basic({
        floodWaiter: { maxRetries: MAX_FLOOD_RETRIES, maxWait: MAX_FLOOD_WAIT_MS },
      }),
    },
    storage: SESSION_PATH,
    updates: {
      catchUp: false,
      messageGroupingInterval: MESSAGE_GROUPING_INTERVAL,
    },
  };
}

function createTelegramClient(settings: Pick<Settings, "apiId" | "apiHash">): TelegramClient {
  return new TelegramClient(telegramClientOptions(settings));
}

const daemonStartParams = {
  code: (): Promise<string> => Promise.reject(new Error("run login first")),
  password: (): Promise<string> => Promise.reject(new Error("run login first")),
  phone: (): Promise<string> => Promise.reject(new Error("run login first")),
};

interface SessionClient {
  start: (params?: typeof daemonStartParams) => Promise<unknown>;
}

async function startDaemonSession(client: SessionClient): Promise<void> {
  await client.start(daemonStartParams);
}

function createTelegramAdapter(client: TelegramClientLike): Telegram {
  const postHandlers: ((post: Post) => void)[] = [];
  const photoLocations = new WeakMap<object, FileDownloadLocation>();
  let postStreamStarted = false;

  function startPostStream(): void {
    if (postStreamStarted) {
      return;
    }

    postStreamStarted = true;
    client.onNewMessage.add((message) => {
      emitPost([message]);
    });
    client.onMessageGroup.add((messages) => {
      emitPost(messages);
    });
  }

  function emitPost(messages: readonly Message[]): void {
    const postMessages = messages
      .filter((message) => !message.isService)
      .toSorted((left, right) => left.id - right.id);

    if (postMessages.length === 0) {
      return;
    }

    const [firstMessage] = postMessages;
    const albumId = firstMessage.groupedIdUnique;
    const post: Post = {
      chatId: firstMessage.chat.id,
      link: firstMessage.link,
      messageIds: postMessages.map((message) => message.id),
      photos: postMessages.flatMap((message) => photoRefFor(message)).slice(0, MAX_PHOTOS),
      text: postMessages
        .map((message) => message.text)
        .filter((text) => text !== "")
        .join("\n\n"),
      ...(albumId === undefined || albumId === null ? {} : { albumId }),
    };

    for (const handler of postHandlers) {
      handler(post);
    }
  }

  function photoRefFor(message: Message): PhotoRef[] {
    const { media } = message;
    if (media?.type !== "photo") {
      return [];
    }

    const location = media.getThumbnail("y") ?? media.getThumbnail("x") ?? media;
    const ref = { __photoRef: true } as const;
    photoLocations.set(ref, location);
    return [ref];
  }

  return {
    async downloadPhoto(ref) {
      const location = photoLocations.get(ref);
      if (location === undefined) {
        throw new Error("Unknown Telegram photo reference");
      }
      return client.downloadAsBuffer(location);
    },
    async joinedChannelIds() {
      const channelIds: number[] = [];
      const seen = new Set<number>();

      for await (const dialog of client.iterDialogs({ archived: "keep" })) {
        const peer = dialog.peer ?? dialog.chat;
        if (peer !== undefined && isChannel(peer) && !seen.has(peer.id)) {
          seen.add(peer.id);
          channelIds.push(peer.id);
        }
      }

      return channelIds;
    },
    onPost(handler) {
      postHandlers.push(handler);
      startPostStream();
    },
    async sendToMe(text) {
      await client.sendText("me", taggedForSavedMessages(text), { disableWebPreview: true });
    },
  };
}

/** Tagging and the length cap belong together: the tag counts against the limit. */
function taggedForSavedMessages(text: string): string {
  return `${SAVED_MESSAGES_TAG}\n${text}`.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
}

function isChannel(peer: DialogPeer): boolean {
  return peer.type === "channel" || peer.chatType === "channel" || peer.chatType === "gigagroup";
}

export {
  SESSION_PATH,
  MESSAGE_GROUPING_INTERVAL,
  MAX_FLOOD_WAIT_MS,
  MAX_FLOOD_RETRIES,
  DEVICE_INFO,
  type DialogLike,
  type PhotoRef,
  type Post,
  type Telegram,
  type TelegramClientLike,
  telegramClientOptions,
  createTelegramClient,
  daemonStartParams,
  type SessionClient,
  startDaemonSession,
  createTelegramAdapter,
};
