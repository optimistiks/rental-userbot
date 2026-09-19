import { readFileSync } from 'node:fs'

export function readCriteriaFile(criteriaPath: string): string {
  try {
    return readFileSync(criteriaPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Criteria file "${criteriaPath}" is not readable: ${message}`, {
      cause: error,
    })
  }
}
