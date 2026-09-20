import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readCriteriaFile, readPromptFile } from "./text-file.js";

describe("readCriteriaFile", () => {
  it("reads the criteria text from the configured path", () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const criteriaPath = path.join(directory, "criteria.md");
    writeFileSync(criteriaPath, "Apartment for long-term rent in Batumi.");

    expect(readCriteriaFile(criteriaPath)).toBe("Apartment for long-term rent in Batumi.");
  });

  it("names the Criteria file when it cannot be read", () => {
    expect.hasAssertions();
    const criteriaPath = path.join(tmpdir(), "missing-rental-criteria.md");

    expect(() => readCriteriaFile(criteriaPath)).toThrow(
      new RegExp(`Criteria file .*${criteriaPath}`, "u"),
    );
  });
});

describe("readPromptFile", () => {
  it("reads the prompt text from the configured path", () => {
    expect.hasAssertions();
    const directory = mkdtempSync(path.join(tmpdir(), "rental-userbot-"));
    const promptPath = path.join(directory, "prompt.md");
    writeFileSync(promptPath, "Prompt text");

    expect(readPromptFile(promptPath)).toBe("Prompt text");
  });

  it("names the Prompt file when it cannot be read", () => {
    expect.hasAssertions();
    const promptPath = path.join(tmpdir(), "missing-rental-prompt.md");

    expect(() => readPromptFile(promptPath)).toThrow(
      new RegExp(`Prompt file .*${promptPath}`, "u"),
    );
  });
});
