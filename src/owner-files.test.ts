import { rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { openOwnerFiles } from "./owner-files.js";
import { quiet, writeOwnerFiles, zoneCollection } from "./test-support.js";

describe("openOwnerFiles", () => {
  it.each([
    ["Criteria", "criteriaPath"],
    ["Prompt", "promptPath"],
    ["Zone", "zonePath"],
    ["Watchlist", "channelsPath"],
  ] as const)("names the %s file when it cannot be read at startup", (label, file) => {
    expect.hasAssertions();
    const files = writeOwnerFiles();
    rmSync(files[file]);

    expect(() => openOwnerFiles(files)).toThrow(
      new RegExp(`${label} file .*${files[file]}.* not readable`, "u"),
    );
  });

  it("names a Zone file that is not a usable outline at startup", () => {
    expect.hasAssertions();
    const files = writeOwnerFiles();
    writeFileSync(files.zonePath, "{");

    expect(() => openOwnerFiles(files)).toThrow(/Zone file .*valid GeoJSON/u);
  });

  it("reports the Watchlist size it started with", () => {
    expect.hasAssertions();

    expect(
      openOwnerFiles(writeOwnerFiles("-1001234567890\n-1009876543210\n")).watchedAtStartup,
    ).toBe(2);
  });
});

describe("a Post's read of the Owner files", () => {
  it("hands over the trimmed Criteria and Prompt and the Zone, with no Notice when nothing changed", () => {
    expect.hasAssertions();
    const ownerFiles = openOwnerFiles(writeOwnerFiles());

    const { contents, notice } = ownerFiles.read();

    expect(notice).toBeUndefined();
    expect(contents?.criteria).toBe("Want a 1+1 in Old Town.");
    expect(contents?.prompt).toBe("Judge the listing.");
    expect(contents?.zone.map((feature) => feature.properties?.name)).toStrictEqual(["Old Batumi"]);
  });

  it("notices a Watchlist addition", () => {
    expect.hasAssertions();
    const log = quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);

    writeFileSync(files.channelsPath, "-1001234567890\n-1009876543210\n");

    expect(ownerFiles.read().notice).toBe(
      "🟢 watchlist: watching 2 channels; added -1009876543210",
    );
    expect(log).toHaveBeenCalledWith(
      "notice: 🟢 watchlist: watching 2 channels; added -1009876543210",
    );
    expect(ownerFiles.read().notice).toBeUndefined();
  });

  it("notices a Criteria edit and ignores a comment-only Watchlist edit", () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    writeFileSync(files.channelsPath, "-1001234567890  # Batumi\n");
    writeFileSync(files.criteriaPath, "Want a 1+1 on Rustaveli.\n");

    const { contents, notice } = ownerFiles.read();

    expect(notice).toBe("🟢 criteria: updated");
    expect(contents?.criteria).toBe("Want a 1+1 on Rustaveli.");
  });

  it("notices Prompt and Zone meaning changes in one Notice", () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    writeFileSync(files.promptPath, "Judge photos first.\n");
    writeFileSync(files.zonePath, JSON.stringify(zoneCollection("Rustaveli")));

    expect(ownerFiles.read().notice).toBe("🟢 prompt: updated\n🟢 zone: updated");
  });

  it("says nothing when the Zone is rewritten without moving a vertex", () => {
    expect.hasAssertions();
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    writeFileSync(files.zonePath, `${JSON.stringify(zoneCollection("Old Batumi"), null, 2)}\n`);

    expect(ownerFiles.read().notice).toBeUndefined();
  });

  it("withholds the contents while Criteria is unreadable, warning once", () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    rmSync(files.criteriaPath);

    expect(ownerFiles.read()).toStrictEqual({ notice: "⚠️ criteria: not readable" });
    expect(ownerFiles.read()).toStrictEqual({});

    writeFileSync(files.criteriaPath, "Want a 1+1 in Old Town.\n");
    const { contents, notice } = ownerFiles.read();

    expect(notice).toBe("🟢 criteria: updated");
    expect(contents).toBeDefined();
  });

  it("withholds the contents while the Zone is not a usable outline", () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    writeFileSync(files.zonePath, '{"type":"FeatureCollection","features":[]}');

    expect(ownerFiles.read()).toStrictEqual({ notice: "⚠️ zone: not readable" });
  });
});

describe("the Watchlist check for each message", () => {
  it("re-reads the Watchlist every time", () => {
    expect.hasAssertions();
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);

    expect(ownerFiles.watchedChannelIds()).toStrictEqual([-1_001_234_567_890]);

    writeFileSync(files.channelsPath, "-1009876543210\n");

    expect(ownerFiles.watchedChannelIds()).toStrictEqual([-1_009_876_543_210]);
  });

  it("treats a vanished Watchlist as watching nothing, which is a healthy Notice", () => {
    expect.hasAssertions();
    quiet("log");
    const files = writeOwnerFiles();
    const ownerFiles = openOwnerFiles(files);
    rmSync(files.channelsPath);

    expect(ownerFiles.watchedChannelIds()).toStrictEqual([]);
    const { contents, notice } = ownerFiles.read();
    expect(notice).toBe("🟢 watchlist: watching 0 channels; removed -1001234567890");
    expect(contents).toBeDefined();
  });
});
