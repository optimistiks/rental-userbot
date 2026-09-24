import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { ProcessedPosts } from "./processed-posts.js";

import { openProcessedPosts } from "./processed-posts.js";
import { post, temporaryDirectory } from "./test-support.js";

function open(databasePath = ":memory:"): ProcessedPosts {
  const processedPosts = openProcessedPosts(databasePath);
  onTestFinished(() => {
    processedPosts.close();
  });
  return processedPosts;
}

function work(): ReturnType<typeof vi.fn<() => Promise<void>>> {
  return vi.fn<() => Promise<void>>(() => Promise.resolve());
}

describe("processed posts", () => {
  it("handles a Post once and never again", async () => {
    expect.hasAssertions();
    const processedPosts = open();
    const first = work();
    const second = work();

    await processedPosts.once(post(1), first);
    await processedPosts.once(post(1), second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("turns away a second copy while the first is still being handled", async () => {
    expect.hasAssertions();
    const processedPosts = open();
    const firstCopy: { finish?: () => void } = {};
    const first = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          firstCopy.finish = resolve;
        }),
    );
    const second = work();

    const handling = processedPosts.once(post(2), first);
    await processedPosts.once(post(2), second);
    firstCopy.finish?.();
    await handling;

    expect(second).not.toHaveBeenCalled();
  });

  it("treats an album as one Post, so a late part is turned away", async () => {
    expect.hasAssertions();
    const processedPosts = open();
    const latePart = work();

    await processedPosts.once(post(60, { albumId: "album-8", messageIds: [60, 61] }), work());
    await processedPosts.once(post(62, { albumId: "album-8" }), latePart);

    expect(latePart).not.toHaveBeenCalled();
  });

  it("still counts a Post as processed when handling it throws", async () => {
    expect.hasAssertions();
    const processedPosts = open();
    const retry = work();

    await expect(
      processedPosts.once(post(3), () => Promise.reject(new Error("pipeline bug"))),
    ).rejects.toThrow("pipeline bug");
    await processedPosts.once(post(3), retry);

    expect(retry).not.toHaveBeenCalled();
  });

  it("remembers a Processed Post across a restart", async () => {
    expect.hasAssertions();
    const databasePath = path.join(temporaryDirectory(), "bot.sqlite");
    const afterRestart = work();

    const beforeRestart = openProcessedPosts(databasePath);
    await beforeRestart.once(post(4), work());
    beforeRestart.close();
    await open(databasePath).once(post(4), afterRestart);

    expect(afterRestart).not.toHaveBeenCalled();
  });
});
