import type { MockInstance } from "vitest";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createWatchlist, readWatchlistFile } from "./watchlist.js";

function watchlistFile(contents: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
  const channelsPath = path.join(directory, "channels.txt");
  writeFileSync(channelsPath, contents);
  return channelsPath;
}

function quietLog(): MockInstance<typeof console.log> {
  return vi.spyOn(console, "log").mockImplementation(() => {
    /* Keep test output quiet. */
  });
}

describe("createWatchlist", () => {
  it("reads one marked channel ID per line", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n-1009876543210\n");

    expect(createWatchlist(channelsPath).channelIds()).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });

  it("ignores surrounding whitespace, blank lines and CRLF endings", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("\r\n  -1001234567890  \r\n\r\n\t-1009876543210\r\n");

    expect(createWatchlist(channelsPath).channelIds()).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });

  it("ignores comment lines and keeps an ID labelled after a #", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile(
      "# Batumi\n-1001234567890  # Batumi rentals\n# nothing below\n",
    );

    expect(createWatchlist(channelsPath).channelIds()).toStrictEqual([-1_001_234_567_890]);
  });

  it("ignores lines that are not marked channel IDs", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile(
      ["https://t.me/example", "12345", "-12345", "-100", "-100abc", "@channel", ""].join("\n"),
    );

    expect(createWatchlist(channelsPath).channelIds()).toStrictEqual([]);
  });

  it("ignores an ID too large to be a safe integer", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-100123456789012345678\n-1001234567890\n");

    expect(createWatchlist(channelsPath).channelIds()).toStrictEqual([-1_001_234_567_890]);
  });

  it("counts a repeated ID once", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n-1009876543210\n-1001234567890\n");

    expect(createWatchlist(channelsPath).channelIds()).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });

  it("reads an empty file as watching nothing", () => {
    expect.hasAssertions();

    expect(createWatchlist(watchlistFile("")).channelIds()).toStrictEqual([]);
  });

  it("reads a file of nothing but comments as watching nothing", () => {
    expect.hasAssertions();

    expect(createWatchlist(watchlistFile("# one\n\n#two\n")).channelIds()).toStrictEqual([]);
  });

  it("reads a missing file as watching nothing", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n");
    const watchlist = createWatchlist(channelsPath);
    const log = quietLog();

    expect(watchlist.channelIds()).toStrictEqual([-1_001_234_567_890]);

    rmSync(channelsPath);

    expect(watchlist.channelIds()).toStrictEqual([]);

    log.mockRestore();
  });
});

describe("watchlist change logging", () => {
  it("says nothing on the first read", () => {
    expect.hasAssertions();
    const watchlist = createWatchlist(watchlistFile("-1001234567890\n"));
    const log = quietLog();

    watchlist.channelIds();

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("logs the new count and the added ID once", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n");
    const watchlist = createWatchlist(channelsPath);
    const log = quietLog();
    watchlist.channelIds();
    writeFileSync(channelsPath, "-1001234567890\n-1009876543210\n");

    watchlist.channelIds();
    watchlist.channelIds();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("watchlist: watching 2 channels; added -1009876543210");
    log.mockRestore();
  });

  it("logs the new count and the removed ID", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n-1009876543210\n");
    const watchlist = createWatchlist(channelsPath);
    const log = quietLog();
    watchlist.channelIds();
    writeFileSync(channelsPath, "-1009876543210\n");

    watchlist.channelIds();

    expect(log).toHaveBeenCalledWith("watchlist: watching 1 channel; removed -1001234567890");
    log.mockRestore();
  });

  it("reports an addition and a removal in the same line", () => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n");
    const watchlist = createWatchlist(channelsPath);
    const log = quietLog();
    watchlist.channelIds();
    writeFileSync(channelsPath, "-1009876543210\n");

    watchlist.channelIds();

    expect(log).toHaveBeenCalledWith(
      "watchlist: watching 1 channel; added -1009876543210; removed -1001234567890",
    );
    log.mockRestore();
  });

  it.each([
    ["reordered lines", "-1009876543210\n-1001234567890\n"],
    ["an added comment", "# my channels\n-1001234567890\n-1009876543210\n"],
    ["an added label", "-1001234567890 # Batumi\n-1009876543210\n"],
    ["a removed duplicate", "-1001234567890\n-1009876543210\n"],
  ])("says nothing about %s", (_edit, rewritten) => {
    expect.hasAssertions();
    const channelsPath = watchlistFile("-1001234567890\n-1009876543210\n-1001234567890\n");
    const watchlist = createWatchlist(channelsPath);
    const log = quietLog();
    watchlist.channelIds();
    writeFileSync(channelsPath, rewritten);

    watchlist.channelIds();

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("readWatchlistFile", () => {
  it("reads the channel IDs from the configured path", () => {
    expect.hasAssertions();

    expect(readWatchlistFile(watchlistFile("-1001234567890\n"))).toStrictEqual([
      -1_001_234_567_890,
    ]);
  });

  it("names the Watchlist file when it cannot be read", () => {
    expect.hasAssertions();
    const channelsPath = path.join(tmpdir(), "missing-rental-channels.txt");

    expect(() => readWatchlistFile(channelsPath)).toThrow(
      new RegExp(`Watchlist file .*${channelsPath}`, "u"),
    );
  });
});
