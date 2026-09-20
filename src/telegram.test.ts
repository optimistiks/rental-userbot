import { describe, expect, it, vi } from "vitest";

import type { Settings } from "./config.js";

import {
  daemonStartParams,
  createTelegramAdapter,
  telegramClientOptions,
  DEVICE_INFO,
  MAX_FLOOD_WAIT_MS,
  startDaemonSession,
} from "./telegram.js";

const settings = {
  apiId: 123456,
  apiHash: "hash",
} satisfies Pick<Settings, "apiId" | "apiHash">;

describe("telegram client setup", () => {
  it("uses the persistent session and the specified update settings", () => {
    expect(telegramClientOptions(settings)).toMatchObject({
      apiId: 123456,
      apiHash: "hash",
      storage: "data/session.sqlite",
      initConnectionOptions: DEVICE_INFO,
      updates: {
        catchUp: false,
        messageGroupingInterval: 1000,
      },
    });
  });

  it("sleeps through flood waits instead of dying mid-flood", () => {
    expect(telegramClientOptions(settings)).toMatchObject({
      network: { middlewares: expect.any(Array) },
    });
    expect(MAX_FLOOD_WAIT_MS).toBeGreaterThan(10_000);
  });

  it("refuses interactive prompts when starting the daemon", async () => {
    const start = vi.fn(async (params: typeof daemonStartParams) => {
      await params.phone?.();
    });

    await expect(startDaemonSession({ start })).rejects.toThrow("run login first");
    expect(start).toHaveBeenCalledWith(daemonStartParams);
  });
});

describe("Telegram adapter", () => {
  it("starts the Post stream when a handler is registered", () => {
    const onNewMessage = { add: vi.fn() };
    const onMessageGroup = { add: vi.fn() };
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
      onMessageGroup,
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn();

    telegram.onPost(handler);

    expect(onNewMessage.add).toHaveBeenCalledOnce();
    expect(onMessageGroup.add).toHaveBeenCalledOnce();
  });

  it("turns a non-service message into a text-only Post", () => {
    const onNewMessage = { add: vi.fn() };
    const onMessageGroup = { add: vi.fn() };
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
      onMessageGroup,
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0];

    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 42,
      isService: false,
      link: "https://t.me/example/42",
      text: "Flat for rent",
    });

    expect(handler).toHaveBeenCalledWith({
      chatId: -1001234567890,
      messageIds: [42],
      text: "Flat for rent",
      photos: [],
      link: "https://t.me/example/42",
    });
  });

  it("does not emit service messages", () => {
    const onNewMessage = { add: vi.fn() };
    const onMessageGroup = { add: vi.fn() };
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
      onMessageGroup,
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0];

    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 43,
      isService: true,
      link: "https://t.me/example/43",
      text: "",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("turns an album into one ordered Post with captions and photo references", async () => {
    const onNewMessage = { add: vi.fn() };
    const onMessageGroup = { add: vi.fn() };
    const firstThumbnail = { name: "first-y" };
    const secondThumbnail = { name: "second-x" };
    const thirdPhoto = {
      type: "photo" as const,
      getThumbnail: vi.fn(() => null),
    };
    const firstPhoto = {
      type: "photo" as const,
      getThumbnail: vi.fn((size: string) => (size === "y" ? firstThumbnail : null)),
    };
    const secondPhoto = {
      type: "photo" as const,
      getThumbnail: vi.fn((size: string) => (size === "x" ? secondThumbnail : null)),
    };
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(async (location) => location),
      onNewMessage,
      onMessageGroup,
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn();
    telegram.onPost(handler);
    const onMessageGroupHandler = onMessageGroup.add.mock.calls[0][0];

    onMessageGroupHandler([
      {
        chat: { id: -1001234567890 },
        id: 43,
        isService: false,
        groupedIdUnique: "album-7",
        link: "https://t.me/example/43",
        text: "Second caption",
        media: secondPhoto,
      },
      {
        chat: { id: -1001234567890 },
        id: 42,
        isService: false,
        groupedIdUnique: "album-7",
        link: "https://t.me/example/42",
        text: "First caption",
        media: firstPhoto,
      },
      {
        chat: { id: -1001234567890 },
        id: 44,
        isService: false,
        groupedIdUnique: "album-7",
        link: "https://t.me/example/44",
        text: "",
        media: thirdPhoto,
      },
    ]);

    expect(handler).toHaveBeenCalledOnce();
    const [post] = handler.mock.calls[0];
    expect(post).toMatchObject({
      chatId: -1001234567890,
      messageIds: [42, 43, 44],
      albumId: "album-7",
      text: "First caption\n\nSecond caption",
      link: "https://t.me/example/42",
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
    const onNewMessage = { add: vi.fn() };
    const onMessageGroup = { add: vi.fn() };
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
      onMessageGroup,
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn();
    telegram.onPost(handler);
    const photos = Array.from({ length: 7 }, (_, index) => ({
      type: "photo" as const,
      getThumbnail: vi.fn(() => ({ index })),
    }));
    const onMessageGroupHandler = onMessageGroup.add.mock.calls[0][0];

    onMessageGroupHandler(
      photos.map((media, index) => ({
        chat: { id: -1001234567890 },
        id: 80 + index,
        isService: false,
        groupedIdUnique: "album-9",
        link: `https://t.me/example/${80 + index}`,
        text: "",
        media,
      })),
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].photos).toHaveLength(6);
  });

  it("includes a photo on a single-message Post and skips non-photo media", () => {
    const onNewMessage = { add: vi.fn() };
    const onMessageGroup = { add: vi.fn() };
    const photo = {
      type: "photo" as const,
      getThumbnail: vi.fn(() => null),
    };
    const client = {
      sendText: vi.fn(),
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage,
      onMessageGroup,
    };
    const telegram = createTelegramAdapter(client);
    const handler = vi.fn();
    telegram.onPost(handler);
    const onNewMessageHandler = onNewMessage.add.mock.calls[0][0];

    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 44,
      isService: false,
      link: "https://t.me/example/44",
      text: "Photo flat",
      media: photo,
    });
    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 45,
      isService: false,
      link: "https://t.me/example/45",
      text: "Video flat",
      media: { type: "video", getThumbnail: vi.fn() },
    });
    onNewMessageHandler({
      chat: { id: -1001234567890 },
      id: 46,
      isService: false,
      link: "https://t.me/example/46",
      text: "Document flat",
      media: { type: "document", getThumbnail: vi.fn() },
    });

    expect(handler.mock.calls[0][0].photos).toHaveLength(1);
    expect(handler.mock.calls[1][0].photos).toHaveLength(0);
    expect(handler.mock.calls[2][0].photos).toHaveLength(0);
  });

  it("sends to Saved Messages with link previews disabled", async () => {
    const sendText = vi.fn(async () => undefined);
    const client = {
      sendText,
      iterDialogs: async function* () {},
      downloadAsBuffer: vi.fn(),
      onNewMessage: { add: vi.fn() },
      onMessageGroup: { add: vi.fn() },
    };
    const telegram = createTelegramAdapter(client);

    await telegram.sendToMe("https://t.me/example/1\nLooks good");

    expect(sendText).toHaveBeenCalledWith("me", "https://t.me/example/1\nLooks good", {
      disableWebPreview: true,
    });
  });

  it("lists marked IDs for joined channels, including archived dialogs", async () => {
    const iterDialogs = vi.fn(async function* () {
      yield { peer: { type: "chat", chatType: "channel", id: -1001234567890 } };
      yield { peer: { type: "chat", chatType: "supergroup", id: -1002222222222 } };
      yield { peer: { type: "chat", chatType: "channel", id: -1009876543210 } };
    });
    const client = {
      sendText: vi.fn(),
      iterDialogs,
      downloadAsBuffer: vi.fn(),
      onNewMessage: { add: vi.fn() },
      onMessageGroup: { add: vi.fn() },
    };
    const telegram = createTelegramAdapter(client);

    await expect(telegram.joinedChannelIds()).resolves.toEqual([-1001234567890, -1009876543210]);
    expect(iterDialogs).toHaveBeenCalledWith({ archived: "keep" });
  });
});
