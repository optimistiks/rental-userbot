import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";
import type { Post, SessionClient, DialogLike, TelegramClientLike } from "./telegram.js";

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
      network: { middlewares: expect.any(Array) },
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
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn<(post: Post) => void>();

    telegram.onPost(handler);

    expect(onNewMessage.add).toHaveBeenCalledOnce();
    expect(onMessageGroup.add).toHaveBeenCalledOnce();
  });

  it("turns a non-service message into a text-only Post", () => {
    expect.hasAssertions();
    const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
    const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);
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
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);
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
      getThumbnail: vi.fn<(size: string) => { name: string } | null>((size) =>
        size === "y" ? firstThumbnail : null,
      ),
      type: "photo" as const,
    };
    const secondPhoto = {
      getThumbnail: vi.fn<(size: string) => { name: string } | null>((size) =>
        size === "x" ? secondThumbnail : null,
      ),
      type: "photo" as const,
    };
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(
        async (location) => location as unknown as Uint8Array,
      ),
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);
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

    expect(handler).toHaveBeenCalledOnce();
    const [post] = handler.mock.calls[0];
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
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);
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

    expect(handler).toHaveBeenCalledOnce();
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
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup,
      onNewMessage,
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);
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

  it("sends to Saved Messages with link previews disabled", async () => {
    expect.hasAssertions();
    const sendText = vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve());
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      async *iterDialogs(): AsyncGenerator<DialogLike> {
        /* No dialogs in this test. */
      },
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
      sendText,
    };
    const telegram = createTelegramAdapter(client);

    await telegram.sendToMe("https://t.me/example/1\nLooks good");

    expect(sendText).toHaveBeenCalledWith("me", "https://t.me/example/1\nLooks good", {
      disableWebPreview: true,
    });
  });

  it("lists marked IDs for joined channels, including archived dialogs", async () => {
    expect.hasAssertions();
    const iterDialogs = vi.fn<TelegramClientLike["iterDialogs"]>(async function* iterDialogs() {
      yield { peer: { chatType: "channel", id: -1_001_234_567_890, type: "chat" } };
      yield { peer: { chatType: "supergroup", id: -1_002_222_222_222, type: "chat" } };
      yield { peer: { chatType: "channel", id: -1_009_876_543_210, type: "chat" } };
    });
    const client = {
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
      iterDialogs,
      onMessageGroup: { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() },
      onNewMessage: { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() },
      sendText: vi.fn<TelegramClientLike["sendText"]>(),
    };
    const telegram = createTelegramAdapter(client);

    await expect(telegram.joinedChannelIds()).resolves.toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
    expect(iterDialogs).toHaveBeenCalledWith({ archived: "keep" });
  });
});
