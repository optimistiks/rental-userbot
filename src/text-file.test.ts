import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readCriteriaFile, readPromptFile } from './text-file.js'

describe('readCriteriaFile', () => {
  it('reads the criteria text from the configured path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(criteriaPath, 'Apartment for long-term rent in Batumi.')

    expect(readCriteriaFile(criteriaPath)).toBe('Apartment for long-term rent in Batumi.')
  })

  it('names the Criteria file when it cannot be read', () => {
    const criteriaPath = join(tmpdir(), 'missing-rental-criteria.md')

    expect(() => readCriteriaFile(criteriaPath)).toThrowError(
      new RegExp(`Criteria file .*${criteriaPath}`),
    )
  })
})

describe('readPromptFile', () => {
  it('reads the prompt text from the configured path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    writeFileSync(promptPath, 'Prompt text')

    expect(readPromptFile(promptPath)).toBe('Prompt text')
  })

  it('names the Prompt file when it cannot be read', () => {
    const promptPath = join(tmpdir(), 'missing-rental-prompt.md')

    expect(() => readPromptFile(promptPath)).toThrowError(
      new RegExp(`Prompt file .*${promptPath}`),
    )
  })
})
