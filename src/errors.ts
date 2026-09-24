function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorName(error: unknown): string {
  return isRecord(error) && typeof error.name === "string" && error.name !== ""
    ? error.name
    : "Error";
}

export { errorMessage, errorName, isRecord };
