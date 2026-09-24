import { rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createNotices } from "./notices.js";
import { ownerFiles, quiet, zoneCollection } from "./test-support.js";

describe("createNotices", () => {
  it("notices a Watchlist addition after the seed read", () => {
    expect.hasAssertions();
    const log = quiet("log");
    const files = ownerFiles();
    const notices = createNotices(files);

    expect(notices.pull()).toStrictEqual({ canEvaluate: true });

    writeFileSync(files.channelsPath, "-1001234567890\n-1009876543210\n");

    expect(notices.pull()).toStrictEqual({
      canEvaluate: true,
      notice: "🟢 watchlist: watching 2 channels; added -1009876543210",
    });
    expect(log).toHaveBeenCalledWith(
      "notice: 🟢 watchlist: watching 2 channels; added -1009876543210",
    );
  });

  it("notices a Criteria edit and ignores a comment-only Watchlist edit", () => {
    expect.hasAssertions();
    quiet("log");
    const files = ownerFiles();
    const notices = createNotices(files);
    writeFileSync(files.channelsPath, "-1001234567890  # Batumi\n");
    writeFileSync(files.criteriaPath, "Want a 1+1 on Rustaveli.\n");

    expect(notices.pull()).toStrictEqual({
      canEvaluate: true,
      notice: "🟢 criteria: updated",
    });
  });

  it("notices Prompt and Zone meaning changes in one message", () => {
    expect.hasAssertions();
    quiet("log");
    const files = ownerFiles();
    const notices = createNotices(files);
    writeFileSync(files.promptPath, "Judge photos first.\n");
    writeFileSync(files.zonePath, JSON.stringify(zoneCollection("Rustaveli")));

    expect(notices.pull()).toStrictEqual({
      canEvaluate: true,
      notice: "🟢 prompt: updated\n🟢 zone: updated",
    });
  });

  it("says nothing when the Zone JSON is rewritten without moving a vertex", () => {
    expect.hasAssertions();
    const files = ownerFiles();
    const notices = createNotices(files);
    writeFileSync(files.zonePath, `${JSON.stringify(zoneCollection("Old Batumi"), null, 2)}\n`);

    expect(notices.pull()).toStrictEqual({ canEvaluate: true });
  });

  it("warns when Criteria becomes unreadable and does not evaluate until it reads", () => {
    expect.hasAssertions();
    quiet("log");
    const files = ownerFiles();
    const notices = createNotices(files);
    rmSync(files.criteriaPath);

    expect(notices.pull()).toStrictEqual({
      canEvaluate: false,
      notice: "⚠️ criteria: not readable",
    });
    expect(notices.pull()).toStrictEqual({ canEvaluate: false });

    writeFileSync(files.criteriaPath, "Want a 1+1 in Old Town.\n");

    expect(notices.pull()).toStrictEqual({
      canEvaluate: true,
      notice: "🟢 criteria: updated",
    });
  });

  it("treats a vanished Watchlist as watching nothing", () => {
    expect.hasAssertions();
    quiet("log");
    const files = ownerFiles();
    const notices = createNotices(files);
    rmSync(files.channelsPath);

    expect(notices.pull()).toStrictEqual({
      canEvaluate: true,
      notice: "🟢 watchlist: watching 0 channels; removed -1001234567890",
    });
  });
});
