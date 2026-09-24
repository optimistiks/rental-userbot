import type { Mock } from "vitest";

import { describe, expect, it, vi } from "vitest";

import type { Post, Telegram, TelegramClientLike } from "./telegram.js";

import { createTelegramAdapter, telegramClientOptions } from "./telegram.js";
import { WATCHED_CHANNEL_ID } from "./test-support.js";

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

interface ClientMocks {
  downloadAsBuffer: Mock<TelegramClientLike["downloadAsBuffer"]>;
  sendText: Mock<TelegramClientLike["sendText"]>;
}

interface Harness {
  client: ClientMocks;
  handler: Mock<(post: Post) => void>;
  telegram: Telegram;
  newMessage: (message: FakeMessage) => void;
  messageGroup: (messages: FakeMessage[]) => void;
}

/** An adapter over a fake client, with a Post handler already registered. */
function harness(
  client: Partial<ClientMocks> = {},
  channelIds: () => readonly number[] = () => [WATCHED_CHANNEL_ID],
): Harness {
  const onNewMessage = { add: vi.fn<TelegramClientLike["onNewMessage"]["add"]>() };
  const onMessageGroup = { add: vi.fn<TelegramClientLike["onMessageGroup"]["add"]>() };
  const mocks: ClientMocks = {
    downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>(),
    sendText: vi.fn<TelegramClientLike["sendText"]>(() => Promise.resolve()),
    ...client,
  };
  const telegram = createTelegramAdapter({ ...mocks, onMessageGroup, onNewMessage }, channelIds);
  const handler = vi.fn<(post: Post) => void>();
  telegram.onPost(handler);
  return {
    client: mocks,
    handler,
    messageGroup: onMessageGroup.add.mock.calls[0][0] as unknown as Harness["messageGroup"],
    newMessage: onNewMessage.add.mock.calls[0][0] as unknown as Harness["newMessage"],
    telegram,
  };
}

function message(id: number, overrides: Partial<FakeMessage> = {}): FakeMessage {
  return {
    chat: { id: WATCHED_CHANNEL_ID },
    id,
    isService: false,
    link: `https://t.me/example/${id}`,
    text: "Flat for rent",
    ...overrides,
  };
}

/** A photo whose thumbnails answer only for the one size given. */
function photo(
  size?: string,
  thumbnail?: unknown,
): { getThumbnail: (s: string) => unknown } & {
  type: "photo";
} {
  return {
    getThumbnail: (requested) => (requested === size ? thumbnail : null),
    type: "photo",
  };
}

describe("telegram client setup", () => {
  it("uses the persistent session and the specified update settings", () => {
    expect.hasAssertions();
    expect(telegramClientOptions({ apiHash: "hash", apiId: 123_456 })).toMatchObject({
      apiHash: "hash",
      apiId: 123_456,
      storage: "data/session.sqlite",
      updates: {
        catchUp: false,
        messageGroupingInterval: 1000,
      },
    });
  });
});

describe("telegram adapter", () => {
  it("turns a non-service message into a text-only Post", () => {
    expect.hasAssertions();
    const { handler, newMessage } = harness();

    newMessage(message(42));

    expect(handler).toHaveBeenCalledWith({
      chatId: WATCHED_CHANNEL_ID,
      link: "https://t.me/example/42",
      messageIds: [42],
      photos: [],
      text: "Flat for rent",
    });
  });

  it("does not emit service messages", () => {
    expect.hasAssertions();
    const { handler, newMessage } = harness();

    newMessage(message(43, { isService: true, text: "" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not emit a message from a chat that is not on the Watchlist", () => {
    expect.hasAssertions();
    const { handler, newMessage } = harness();

    expect(() => {
      newMessage({
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
    const { handler, newMessage } = harness({}, () => channelIds);

    newMessage(message(42));
    expect(handler).not.toHaveBeenCalled();

    channelIds = [WATCHED_CHANNEL_ID];
    newMessage(message(42));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("turns an album into one ordered Post with captions and photo references", async () => {
    expect.hasAssertions();
    const firstThumbnail = { name: "first-y" };
    const secondThumbnail = { name: "second-x" };
    const thirdPhoto = photo();
    const { client, handler, messageGroup, telegram } = harness({
      downloadAsBuffer: vi.fn<TelegramClientLike["downloadAsBuffer"]>((location) =>
        Promise.resolve(location as unknown as Uint8Array),
      ),
    });

    messageGroup([
      message(43, {
        groupedIdUnique: "album-7",
        media: photo("x", secondThumbnail),
        text: "Second caption",
      }),
      message(42, {
        groupedIdUnique: "album-7",
        media: photo("y", firstThumbnail),
        text: "First caption",
      }),
      message(44, { groupedIdUnique: "album-7", media: thirdPhoto, text: "" }),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    const [[post]] = handler.mock.calls;
    expect(post).toMatchObject({
      albumId: "album-7",
      chatId: WATCHED_CHANNEL_ID,
      link: "https://t.me/example/42",
      messageIds: [42, 43, 44],
      text: "First caption\n\nSecond caption",
    });
    expect(post.photos).toHaveLength(3);
    await expect(telegram.downloadPhoto(post.photos[0])).resolves.toBe(firstThumbnail);
    await expect(telegram.downloadPhoto(post.photos[1])).resolves.toBe(secondThumbnail);
    await expect(telegram.downloadPhoto(post.photos[2])).resolves.toBe(thirdPhoto);
    expect(client.downloadAsBuffer).toHaveBeenCalledTimes(3);
  });

  it("keeps at most six photos in album message order", () => {
    expect.hasAssertions();
    const { handler, messageGroup } = harness();

    messageGroup(
      Array.from({ length: 7 }, (_, index) =>
        message(80 + index, { groupedIdUnique: "album-9", media: photo(), text: "" }),
      ),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].photos).toHaveLength(6);
  });

  it("includes a photo on a single-message Post and skips non-photo media", () => {
    expect.hasAssertions();
    const { handler, newMessage } = harness();

    newMessage(message(44, { media: photo() }));
    newMessage(message(45, { media: { getThumbnail: () => null, type: "video" } }));
    newMessage(message(46, { media: { getThumbnail: () => null, type: "document" } }));

    expect(handler.mock.calls[0][0].photos).toHaveLength(1);
    expect(handler.mock.calls[1][0].photos).toHaveLength(0);
    expect(handler.mock.calls[2][0].photos).toHaveLength(0);
  });

  it("tags a Saved Messages write and disables its link preview", async () => {
    expect.hasAssertions();
    const { client, telegram } = harness();

    await telegram.sendToMe("https://t.me/example/1\nLooks good");

    expect(client.sendText).toHaveBeenCalledWith(
      "me",
      "#rental_userbot\nhttps://t.me/example/1\nLooks good",
      { disableWebPreview: true },
    );
  });

  it("caps a tagged write at Telegram's message length limit", async () => {
    expect.hasAssertions();
    const { client, telegram } = harness();

    await telegram.sendToMe("x".repeat(5000));

    /* Asserting the limit itself, not the formula the adapter uses to reach it. */
    const [[, sent]] = client.sendText.mock.calls;
    expect(sent).toHaveLength(4096);
    expect(sent).toMatch(/^#rental_userbot\n/u);
  });

  it("makes one explicit Telegram call at a time, and a failed call does not block the next", async () => {
    expect.hasAssertions();
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
    const { telegram } = harness({
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
      sendText: vi.fn<TelegramClientLike["sendText"]>(() => enter("send")),
    });

    // Settled up front so the failing download's rejection is handled before it happens.
    const outcomes = Promise.allSettled([
      telegram.downloadPhoto("photo-50"),
      telegram.sendToMe("Match"),
      telegram.downloadPhoto("photo-51"),
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
