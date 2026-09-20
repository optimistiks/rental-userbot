import { describe, expect, it } from "vitest";

import { isWatchedPost } from "./channel-filter.js";

describe("isWatchedPost", () => {
  it("keeps Posts from configured channels", () => {
    expect.hasAssertions();
    expect(isWatchedPost({ chatId: -1_001_234_567_890 }, [-1_001_234_567_890])).toBe(true);
  });

  it("drops Posts from other chats", () => {
    expect.hasAssertions();
    expect(isWatchedPost({ chatId: -1_001_234_567_890 }, [-1_009_876_543_210])).toBe(false);
  });
});
