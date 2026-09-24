import type { FileDownloadLocation, Message } from "@mtcute/node";

import { TelegramClient, networkMiddlewares } from "@mtcute/node";

import type { LoginSettings } from "./config.js";

/**
 * Stamped on every write to Saved Messages so the owner can filter what the bot
 * wrote out of a chat they also use by hand. Telegram ends a hashtag at the
 * first character that is not a letter, digit or underscore, so a hyphen here
 * would post as the hashtag "#rental" and the plain text "-userbot".
 */
const SAVED_MESSAGES_TAG = "#rental_userbot";
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

/** Pinned so an mtcute upgrade doesn't silently change how this session is listed under Telegram's Devices. */
const DEVICE_INFO = {
  appVersion: "0.1.0",
  deviceModel: "rental-userbot",
  systemVersion: "docker",
} as const;

/** Where one photo of a Post can be downloaded from. */
type PhotoRef = FileDownloadLocation;

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
}

interface MessageEmitter<T> {
  add: (listener: (value: T) => void) => void;
}

interface TelegramClientLike {
  onNewMessage: MessageEmitter<Message>;
  onMessageGroup: MessageEmitter<Message[]>;
  sendText: (chatId: "me", text: string, params: { disableWebPreview: true }) => Promise<unknown>;
  downloadAsBuffer: (location: FileDownloadLocation) => Promise<Uint8Array>;
}

type TelegramClientOptions = ConstructorParameters<typeof TelegramClient>[0];

function telegramClientOptions(settings: LoginSettings): TelegramClientOptions {
  return {
    apiHash: settings.apiHash,
    apiId: settings.apiId,
    initConnectionOptions: DEVICE_INFO,
    network: {
      /* Telegram answers a flood wait with "back off for N seconds". mtcute sleeps
         through waits up to 10s by default and throws above that; the process would
         then die mid-flood. Sleeping through waits up to 5 minutes obeys Telegram
         instead of arguing with it. */
      middlewares: networkMiddlewares.basic({
        floodWaiter: { maxRetries: 3, maxWait: 300_000 },
      }),
    },
    storage: "data/session.sqlite",
    updates: {
      catchUp: false,
      messageGroupingInterval: 1000,
    },
  };
}

function createTelegramClient(settings: LoginSettings): TelegramClient {
  return new TelegramClient(telegramClientOptions(settings));
}

const refuseLogin = (): Promise<string> => Promise.reject(new Error("run login first"));

/** The daemon never prompts: a session that needs a code or password goes through `login`. */
const daemonStartParams = { code: refuseLogin, password: refuseLogin, phone: refuseLogin };

interface SessionClient {
  start: (params?: typeof daemonStartParams) => Promise<unknown>;
}

function createTelegramAdapter(
  client: TelegramClientLike,
  channelIds: () => readonly number[],
): Telegram {
  let callTail: Promise<unknown> = Promise.resolve();

  /* Listings are evaluated concurrently, but the account still makes one explicit
     call at a time: downloads and Saved Messages writes never overlap. */
  function oneAtATime<T>(call: () => Promise<T>): Promise<T> {
    // oxlint-disable-next-line promise/prefer-await-to-then
    const result = callTail.then(call);
    // oxlint-disable-next-line promise/prefer-await-to-then
    callTail = result.catch(() => {
      /* Each caller handles its own failure; the next call still runs. */
    });
    return result;
  }

  function toPost(messages: readonly Message[]): Post | undefined {
    const postMessages = messages
      .filter((message) => !message.isService)
      .toSorted((left, right) => left.id - right.id);

    if (postMessages.length === 0) {
      return undefined;
    }

    const [firstMessage] = postMessages;
    // Applied before Message.link: a user chat has no permalink and mtcute throws, restarting the updates loop.
    if (!channelIds().includes(firstMessage.chat.id)) {
      return undefined;
    }

    const albumId = firstMessage.groupedIdUnique;
    return {
      chatId: firstMessage.chat.id,
      link: firstMessage.link,
      messageIds: postMessages.map((message) => message.id),
      photos: postMessages.flatMap((message) => photoOf(message)),
      text: postMessages
        .map((message) => message.text)
        .filter((text) => text !== "")
        .join("\n\n"),
      ...(albumId === undefined || albumId === null ? {} : { albumId }),
    };
  }

  return {
    downloadPhoto: (ref) => oneAtATime(() => client.downloadAsBuffer(ref)),
    onPost(handler) {
      const emit = (messages: readonly Message[]): void => {
        const post = toPost(messages);
        if (post !== undefined) {
          handler(post);
        }
      };
      client.onNewMessage.add((message) => {
        emit([message]);
      });
      client.onMessageGroup.add(emit);
    },
    async sendToMe(text) {
      await oneAtATime(() =>
        client.sendText("me", taggedForSavedMessages(text), { disableWebPreview: true }),
      );
    },
  };
}

function photoOf(message: Message): PhotoRef[] {
  const { media } = message;
  return media?.type === "photo"
    ? [media.getThumbnail("y") ?? media.getThumbnail("x") ?? media]
    : [];
}

/** Tagging and the length cap belong together: the tag counts against the limit. */
function taggedForSavedMessages(text: string): string {
  return `${SAVED_MESSAGES_TAG}\n${text}`.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
}

export {
  type PhotoRef,
  type Post,
  type Telegram,
  type TelegramClientLike,
  type SessionClient,
  telegramClientOptions,
  createTelegramClient,
  daemonStartParams,
  createTelegramAdapter,
};
