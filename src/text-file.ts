import { readFileSync } from 'node:fs'

import { errorMessage } from './errors.js'

export function readConfiguredTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`${label} file "${path}" is not readable: ${errorMessage(error)}`, {
      cause: error,
    })
  }
}

export function readCriteriaFile(criteriaPath: string): string {
  return readConfiguredTextFile(criteriaPath, 'Criteria')
}

export function readPromptFile(promptPath: string): string {
  return readConfiguredTextFile(promptPath, 'Prompt')
}
