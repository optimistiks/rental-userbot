import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { temporaryDirectory } from "./test-support.js";
import { watchedChannelIds } from "./watchlist.js";

function watchlistFile(contents: string): string {
  const channelsPath = path.join(temporaryDirectory(), "channels.txt");
  writeFileSync(channelsPath, contents);
  return channelsPath;
}

describe("watchedChannelIds", () => {
  it("reads one marked channel ID per line", () => {
    expect.hasAssertions();

    expect(watchedChannelIds(watchlistFile("-1001234567890\n-1009876543210\n"))).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });

  it("ignores surrounding whitespace, blank lines and CRLF endings", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("\r\n  -1001234567890  \r\n\r\n\t-1009876543210\r\n");

    expect(watchedChannelIds(channelsPath)).toStrictEqual([-1_001_234_567_890, -1_009_876_543_210]);
  });

  it("ignores comment lines and keeps an ID labelled after a #", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile(
      "# Batumi\n-1001234567890  # Batumi rentals\n# nothing below\n",
    );

    expect(watchedChannelIds(channelsPath)).toStrictEqual([-1_001_234_567_890]);
  });

  it("ignores lines that are not marked channel IDs", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile(
      ["https://t.me/example", "12345", "-12345", "-100", "-100abc", "@channel", ""].join("\n"),
    );

    expect(watchedChannelIds(channelsPath)).toStrictEqual([]);
  });

  it("ignores an ID too large to be a safe integer", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-100123456789012345678\n-1001234567890\n");

    expect(watchedChannelIds(channelsPath)).toStrictEqual([-1_001_234_567_890]);
  });

  it("counts a repeated ID once", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n-1009876543210\n-1001234567890\n");

    expect(watchedChannelIds(channelsPath)).toStrictEqual([-1_001_234_567_890, -1_009_876_543_210]);
  });

  it("reads a missing file as watching nothing", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n");
    rmSync(channelsPath);

    expect(watchedChannelIds(channelsPath)).toStrictEqual([]);
  });
});
