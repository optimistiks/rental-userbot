import { readFileSync } from "node:fs";

import { errorMessage } from "./errors.js";

function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${label} file "${path}" is not readable: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export { readTextFile };
