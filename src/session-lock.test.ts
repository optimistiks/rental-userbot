import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { acquireSessionLock } from "./session-lock.js";

function lockPath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
  return path.join(directory, "session.lock");
}

describe("acquireSessionLock", () => {
  it("refuses a second holder while the first is running", () => {
    expect.hasAssertions();
    const lockFile = lockPath();
    const first = acquireSessionLock(lockFile);

    expect(() => acquireSessionLock(lockFile)).toThrow(/Another instance/u);

    first.release();
  });

  it("lets the next process in once the lock is released", () => {
    expect.hasAssertions();
    const lockFile = lockPath();
    acquireSessionLock(lockFile).release();

    const second = acquireSessionLock(lockFile);
    expect(second).toBeDefined();
    second.release();
  });
});
