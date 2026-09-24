import { describe, expect, it } from "vitest";

import { parseWatchlist } from "./watchlist.js";

describe("parseWatchlist", () => {
  it("reads one marked channel ID per line", () => {
    expect.hasAssertions();

    expect(parseWatchlist("-1001234567890\n-1009876543210\n")).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });

  it("ignores surrounding whitespace, blank lines and CRLF endings", () => {
    expect.hasAssertions();

    expect(parseWatchlist("\r\n  -1001234567890  \r\n\r\n\t-1009876543210\r\n")).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });

  it("ignores comment lines and keeps an ID labelled after a #", () => {
    expect.hasAssertions();

    expect(
      parseWatchlist("# Batumi\n-1001234567890  # Batumi rentals\n# nothing below\n"),
    ).toStrictEqual([-1_001_234_567_890]);
  });

  it("ignores lines that are not marked channel IDs", () => {
    expect.hasAssertions();

    expect(
      parseWatchlist(
        ["https://t.me/example", "12345", "-12345", "-100", "-100abc", "@channel", ""].join("\n"),
      ),
    ).toStrictEqual([]);
  });

  it("ignores an ID too large to be a safe integer", () => {
    expect.hasAssertions();

    expect(parseWatchlist("-100123456789012345678\n-1001234567890\n")).toStrictEqual([
      -1_001_234_567_890,
    ]);
  });

  it("counts a repeated ID once", () => {
    expect.hasAssertions();

    expect(parseWatchlist("-1001234567890\n-1009876543210\n-1001234567890\n")).toStrictEqual([
      -1_001_234_567_890, -1_009_876_543_210,
    ]);
  });
});
