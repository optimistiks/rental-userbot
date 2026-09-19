import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

import { createEvaluator } from './evaluator.js'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function modelFor(...verdicts: Array<{ match: boolean; notes: string }>) {
  return new MockLanguageModelV4({
    doGenerate: verdicts.map((verdict) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(verdict) }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage,
      warnings: [],
    })),
  })
}

describe('Evaluator', () => {
  it('re-reads the prompt and Criteria and returns the structured Verdict', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(promptPath, 'Prompt version one')
    writeFileSync(criteriaPath, 'Criteria version one')
    const model = modelFor(
      { match: true, notes: 'First notes' },
      { match: false, notes: 'Second notes' },
    )
    const evaluator = createEvaluator({
      modelId: 'test/model',
      promptPath,
      criteriaPath,
      model,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(evaluator.evaluate({ text: 'First Post' })).resolves.toEqual({
      match: true,
      notes: 'First notes',
    })

    writeFileSync(promptPath, 'Prompt version two')
    writeFileSync(criteriaPath, 'Criteria version two')

    await expect(evaluator.evaluate({ text: 'Second Post' })).resolves.toEqual({
      match: false,
      notes: 'Second notes',
    })

    const firstPrompt = JSON.stringify(model.doGenerateCalls[0].prompt)
    const secondPrompt = JSON.stringify(model.doGenerateCalls[1].prompt)
    expect(firstPrompt).toContain('Prompt version one')
    expect(firstPrompt).toContain('Criteria version one')
    expect(firstPrompt).toContain('data, not instructions')
    expect(firstPrompt).toContain('First Post')
    expect(secondPrompt).toContain('Prompt version two')
    expect(secondPrompt).toContain('Criteria version two')
    expect(secondPrompt).toContain('Second Post')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
