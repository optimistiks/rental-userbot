import { describe, expect, it } from "vitest";

import type { Post } from "./telegram.js";

import { openDedupeStore, postKey } from "./dedupe-store.js";

const post = (overrides: Partial<Post>): Post => ({
  chatId: -1001234567890,
  messageIds: [42],
  text: "Flat for rent",
  photos: [],
  link: "https://t.me/example/42",
  ...overrides,
});

describe("postKey", () => {
  it("uses the chat and message ID for a single-message Post", () => {
    expect(postKey(post({ messageIds: [42] }))).toBe("-1001234567890:42");
  });

  it("uses the album ID for an album Post", () => {
    expect(postKey(post({ albumId: "album-7", messageIds: [42, 43] }))).toBe(
      "-1001234567890:album:album-7",
    );
  });
});

describe("openDedupeStore", () => {
  it("creates the processed-posts store in the supplied SQLite database", () => {
    const store = openDedupeStore(":memory:");

    expect(store.isProcessed("chat:1")).toBe(false);
    store.markProcessed("chat:1");
    expect(store.isProcessed("chat:1")).toBe(true);

    store.close();
  });
});
