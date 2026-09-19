import { readFileSync } from 'node:fs'

export function readConfiguredTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} file "${path}" is not readable: ${message}`, {
      cause: error,
    })
  }
}
