import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { acquireSessionLock } from "./session-lock.js";

function lockPath(): string {
  return join(mkdtempSync(join(tmpdir(), "rental-userbot-")), "session.lock");
}

describe(acquireSessionLock, () => {
  it("refuses a second holder while the first is running", () => {
    expect.hasAssertions();
    const path = lockPath();
    const first = acquireSessionLock(path);

    expect(() => acquireSessionLock(path)).toThrow(/Another instance/u);

    first.release();
  });

  it("lets the next process in once the lock is released", () => {
    expect.hasAssertions();
    const path = lockPath();
    acquireSessionLock(path).release();

    const second = acquireSessionLock(path);
    expect(second).toBeDefined();
    second.release();
  });
});
