import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";
import type { Post, SessionClient, TelegramClientLike } from "./telegram.js";

import {
  DEVICE_INFO,
  MAX_FLOOD_WAIT_MS,
  createTelegramAdapter,
  daemonStartParams,
  startDaemonSession,
  telegramClientOptions,
} from "./telegram.js";

/**
 * The fields of mtcute's Message that the adapter reads. Building a real
 * Message would mean fabricating 50-odd properties none of these tests touch,
 * so the listeners are narrowed to this shape where they are pulled off the
 * mock instead.
 */
interface FakeMessage {
  chat: { id: number };
  id: number;
  isService: boolean;
  link: string;
  text: string;
  media?: unknown;
  groupedIdUnique?: string;
}

const settings = {
  apiHash: "hash",
  apiId: 123_456,
} satisfies Pick<Settings, "apiId" | "apiHash">;

const WATCHED_CHANNEL_ID = -1_001_234_567_890;

function watchedChannelIds(): readonly number[] {
  return [WATCHED_CHANNEL_ID];
}

/** A photo thumbnail mock that only answers for one requested size. */
function thumbnailForSize(
  wanted: string,
  thumbnail: { name: string },
): (size: string) => { name: string } | null {
  return (size) => (size === wanted ? thumbnail : null);
}

type SendTextSpy = ReturnType<typeof vi.fn<TelegramClientLike["sendText"]>>;

function clientWithSendSpy(): { client: TelegramClientLike; sendText: SendTextSpy } {
  const sendText = vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve());
  return {
    client: {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
      sendText,
    },
    sendText,
  };
}

/** Unwrapping the spy call out here keeps the conditional out of the test body. */
function lastSentText(sendText: SendTextSpy): string {
  const call = sendText.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("nothing was sent to Saved Messages");
  }
  return call[1];
}

describe("telegram client setup", () => {
  it("uses the persistent session and the specified update settings", () => {
    expect.hasAssertions();
    expect(telegramClientOptions(settings)).toMatchObject({
      apiHash: "hash",
      apiId: 123_456,
      initConnectionOptions: DEVICE_INFO,
      storage: "data/session.sqlite",
      updates: {
        catchUp: false,
        messageGroupingInterval: 1000,
      },
    });
  });

  it("sleeps through flood waits instead of dying mid-flood", () => {
    expect.hasAssertions();
    expect(telegramClientOptions(settings)).toMatchObject({
      network: { middlewares: expect.any(Array) as unknown[] },
    });
    expect(MAX_FLOOD_WAIT_MS).toBeGreaterThan(10_000);
  });

  it("refuses interactive prompts when starting the daemon", async () => {
    expect.hasAssertions();
    const start = vi.fn<SessionClient["start"]>(async (params) => {
      await params?.phone?.();
    });

    await expect(startDaemonSession({ start })).rejects.toThrow("run login first");
    expect(start).toHaveBeenCalledWith(daemonStartParams);
  });
});

describe("telegram adapter", () => {
  it("starts the Post stream when a handler is registered", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();

    telegram.onPost(handler);

    expect(onNewMessage.add).toHaveBeenCalledTimes(1);
    expect(onMessageGroup.add).toHaveBeenCalledTimes(1);
  });

  it("turns a non-service message into a text-only Post", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0] as unknown as (
      message: FakeMessage,
    ) => void;

    onNewMessageHandler({
      chat: { id: -1_001_234_567_890 },
      id: 42,
      isService: false,
      link: "https://t.me/example/42",
      text: "Flat for rent",
    });

    expect(handler).toHaveBeenCalledWith({
      chatId: -1_001_234_567_890,
      link: "https://t.me/example/42",
      messageIds: [42],
      photos: [],
      text: "Flat for rent",
    });
  });

  it("does not emit service messages", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0] as unknown as (
      message: FakeMessage,
    ) => void;

    onNewMessageHandler({
      chat: { id: -1_001_234_567_890 },
      id: 43,
      isService: true,
      link: "https://t.me/example/43",
      text: "",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not emit a message from a chat that is not on the Watchlist", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0] as unknown as (
      message: FakeMessage,
    ) => void;

    expect(() => {
      onNewMessageHandler({
        chat: { id: 323_576_467 },
        id: 1,
        isService: false,
        get link(): string {
          throw new Error("Cannot generate message link for user");
        },
        text: "hello",
      });
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("re-reads the Watchlist for each message", () => {
    expect.hasAssertions();
    let channelIds: number[] = [];
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, () => channelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0] as unknown as (
      message: FakeMessage,
    ) => void;
    const message = {
      chat: { id: WATCHED_CHANNEL_ID },
      id: 42,
      isService: false,
      link: "https://t.me/example/42",
      text: "Flat for rent",
    };

    onNewMessageHandler(message);
    expect(handler).not.toHaveBeenCalled();

    channelIds = [WATCHED_CHANNEL_ID];
    onNewMessageHandler(message);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("turns an album into one ordered Post with captions and photo references", async () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const firstThumbnail = { name: "first-y" };
    const secondThumbnail = { name: "second-x" };
    const thirdPhoto = {
      getThumbnail: vi.fn<(size: string) => { name: string } | null>(() => null),
      type: "photo" as const,
    };
    const firstPhoto = {
      getThumbnail: vi.fn<(size: string) => { name: string } | null>(
        thumbnailForSize("y", firstThumbnail),
      ),
      type: "photo" as const,
    };
    const secondPhoto = {
      getThumbnail: vi.fn<(size: string) => { name: string } | null>(
        thumbnailForSize("x", secondThumbnail),
      ),
      type: "photo" as const,
    };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>((location) =>
        Promise.resolve(location as unknown as Uint8Array),
      ),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onMessageGroupHandler = onMessageGroup.add.mock.calls[0][0] as unknown as (
      messages: FakeMessage[],
    ) => void;

    onMessageGroupHandler([
      {
        chat: { id: -1_001_234_567_890 },
        groupedIdUnique: "album-7",
        id: 43,
        isService: false,
        link: "https://t.me/example/43",
        media: secondPhoto,
        text: "Second caption",
      },
      {
        chat: { id: -1_001_234_567_890 },
        groupedIdUnique: "album-7",
        id: 42,
        isService: false,
        link: "https://t.me/example/42",
        media: firstPhoto,
        text: "First caption",
      },
      {
        chat: { id: -1_001_234_567_890 },
        groupedIdUnique: "album-7",
        id: 44,
        isService: false,
        link: "https://t.me/example/44",
        media: thirdPhoto,
        text: "",
      },
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    const [[post]] = handler.mock.calls;
    expect(post).toMatchObject({
      albumId: "album-7",
      chatId: -1_001_234_567_890,
      link: "https://t.me/example/42",
      messageIds: [42, 43, 44],
      text: "First caption\n\nSecond caption",
    });
    expect(post.photos).toHaveLength(3);
    await expect(telegram.downloadPhoto(post.photos[0])).resolves.toBe(firstThumbnail);
    await expect(telegram.downloadPhoto(post.photos[1])).resolves.toBe(secondThumbnail);
    await expect(telegram.downloadPhoto(post.photos[2])).resolves.toBe(thirdPhoto);
    expect(client.downloadAsBuffer).toHaveBeenNthCalledWith(1, firstThumbnail);
    expect(client.downloadAsBuffer).toHaveBeenNthCalledWith(2, secondThumbnail);
    expect(client.downloadAsBuffer).toHaveBeenNthCalledWith(3, thirdPhoto);
  });

  it("keeps at most six photos in album message order", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const photos = Array.from({ length: 7 }, (_, index) => ({
      getThumbnail: vi.fn<(size: string) => { index: number }>(() => ({ index })),
      type: "photo" as const,
    }));
    const onMessageGroupHandler = onMessageGroup.add.mock.calls[0][0] as unknown as (
      messages: FakeMessage[],
    ) => void;

    onMessageGroupHandler(
      photos.map((media, index) => ({
        chat: { id: -1_001_234_567_890 },
        groupedIdUnique: "album-9",
        id: 80 + index,
        isService: false,
        link: `https://t.me/example/${80 + index}`,
        media,
        text: "",
      })),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].photos).toHaveLength(6);
  });

  it("includes a photo on a single-message Post and skips non-photo media", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const photo = {
      getThumbnail: vi.fn<(size: string) => { name: string } | null>(() => null),
      type: "photo" as const,
    };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0] as unknown as (
      message: FakeMessage,
    ) => void;

    onNewMessageHandler({
      chat: { id: -1_001_234_567_890 },
      id: 44,
      isService: false,
      link: "https://t.me/example/44",
      media: photo,
      text: "Photo flat",
    });
    onNewMessageHandler({
      chat: { id: -1_001_234_567_890 },
      id: 45,
      isService: false,
      link: "https://t.me/example/45",
      media: { getThumbnail: vi.fn<() => null>(), type: "video" },
      text: "Video flat",
    });
    onNewMessageHandler({
      chat: { id: -1_001_234_567_890 },
      id: 46,
      isService: false,
      link: "https://t.me/example/46",
      media: { getThumbnail: vi.fn<() => null>(), type: "document" },
      text: "Document flat",
    });

    expect(handler.mock.calls[0][0].photos).toHaveLength(1);
    expect(handler.mock.calls[1][0].photos).toHaveLength(0);
    expect(handler.mock.calls[2][0].photos).toHaveLength(0);
  });

  it("tags a Saved Messages write and disables its link preview", async () => {
    expect.hasAssertions();
    const { client, sendText } = clientWithSendSpy();
    const telegram = createTelegramAdapter(client, watchedChannelIds);

    await telegram.sendToMe("https://t.me/example/1\nLooks good");

    expect(sendText).toHaveBeenCalledWith(
      "me",
      "#rental_userbot\nhttps://t.me/example/1\nLooks good",
      { disableWebPreview: true },
    );
  });

  it("caps a tagged write at Telegram's message length limit", async () => {
    expect.hasAssertions();
    const { client, sendText } = clientWithSendSpy();
    const telegram = createTelegramAdapter(client, watchedChannelIds);

    await telegram.sendToMe("x".repeat(5000));

    /* Asserting the limit itself, not the formula the adapter uses to reach it. */
    const sent = lastSentText(sendText);
    expect(sent).toHaveLength(4096);
    expect(sent).toMatch(/^#rental_userbot\n/u);
  });

  it("makes one explicit Telegram call at a time, and a failed call does not block the next", async () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const releases: (() => void)[] = [];
    const entered: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const enter = async (name: string): Promise<void> => {
      entered.push(name);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      active -= 1;
    };
    const client = {
      downloadAsBuffer: vi
        .fn<TelegramClientLike["downloadAsBuffer"]>()
        .mockImplementationOnce(async () => {
          await enter("failing");
          throw new Error("download failed");
        })
        .mockImplementation(async () => {
          await enter("second");
          return new Uint8Array();
        }),
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(() => enter("send")),
    };
    const telegram = createTelegramAdapter(client, watchedChannelIds);
    const handler = vi.fn<(post: Post) => void>();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0] as unknown as (
      message: FakeMessage,
    ) => void;
    for (const id of [50, 51]) {
      onNewMessageHandler({
        chat: { id: WATCHED_CHANNEL_ID },
        id,
        isService: false,
        link: `https://t.me/example/${id}`,
        media: { getThumbnail: () => null, type: "photo" },
        text: "Flat",
      });
    }
    const [failingRef, secondRef] = handler.mock.calls.map(([post]) => post.photos[0]);

    // Settled up front so the failing download's rejection is handled before it happens.
    const outcomes = Promise.allSettled([
      telegram.downloadPhoto(failingRef),
      telegram.sendToMe("Match"),
      telegram.downloadPhoto(secondRef),
    ]);

    for (const expected of [["failing"], ["failing", "send"], ["failing", "send", "second"]]) {
      // oxlint-disable-next-line no-await-in-loop -- Each call must be observed alone before the next is released.
      await vi.waitFor(() => {
        expect(entered).toStrictEqual(expected);
      });
      releases.shift()?.();
    }

    const settled = await outcomes;
    expect(settled.map(({ status }) => status)).toStrictEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(maximumActive).toBe(1);
  });
});
