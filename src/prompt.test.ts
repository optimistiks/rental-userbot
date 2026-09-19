import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readPromptFile } from './prompt.js'

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
