import { readConfiguredTextFile } from './text-file.js'

export function readPromptFile(promptPath: string): string {
  return readConfiguredTextFile(promptPath, 'Prompt')
}
