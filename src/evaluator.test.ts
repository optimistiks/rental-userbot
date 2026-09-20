import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

import { createEvaluator } from './evaluator.js'
import type { PhotoRef } from './telegram.js'

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

  it('downloads photos once and sends them after the Post text', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(promptPath, 'Prompt')
    writeFileSync(criteriaPath, 'Criteria')
    const firstPhoto = { __photoRef: true } as PhotoRef
    const secondPhoto = { __photoRef: true } as PhotoRef
    const downloadPhoto = vi
      .fn<(photo: PhotoRef) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([1, 2]))
      .mockResolvedValueOnce(new Uint8Array([3, 4]))
    const model = modelFor({ match: true, notes: 'Looks good' })
    const evaluator = createEvaluator(
      { modelId: 'test/model', promptPath, criteriaPath, model },
      { downloadPhoto },
    )

    await expect(
      evaluator.evaluate({
        text: 'Flat with photos',
        link: 'https://t.me/example/50',
        photos: [firstPhoto, secondPhoto],
      }),
    ).resolves.toEqual({ match: true, notes: 'Looks good' })

    expect(downloadPhoto).toHaveBeenNthCalledWith(1, firstPhoto)
    expect(downloadPhoto).toHaveBeenNthCalledWith(2, secondPhoto)

    const prompt = model.doGenerateCalls[0].prompt
    expect(prompt).toHaveLength(2)
    expect(prompt?.[0]).toEqual(expect.objectContaining({ role: 'system' }))
    expect(prompt?.[1]).toEqual(expect.objectContaining({ role: 'user' }))
    const userContent = (prompt?.[1] as { content: Array<unknown> }).content
    expect(userContent[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('Flat with photos'),
      providerOptions: undefined,
    })
    expect(userContent[1]).toEqual(
      expect.objectContaining({
        type: 'file',
        mediaType: 'image',
        data: { type: 'data', data: new Uint8Array([1, 2]) },
      }),
    )
    expect(userContent[2]).toEqual(
      expect.objectContaining({
        type: 'file',
        mediaType: 'image',
        data: { type: 'data', data: new Uint8Array([3, 4]) },
      }),
    )
  })

  it('returns No match without a model call when all photos fail and text is empty', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(promptPath, 'Prompt')
    writeFileSync(criteriaPath, 'Criteria')
    const firstPhoto = { __photoRef: true } as PhotoRef
    const downloadPhoto = vi.fn(async () => {
      throw new Error('expired file reference')
    })
    const model = modelFor({ match: true, notes: 'Should not run' })
    const evaluator = createEvaluator(
      { modelId: 'test/model', promptPath, criteriaPath, model },
      { downloadPhoto },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      evaluator.evaluate({
        text: '',
        link: 'https://t.me/example/51',
        photos: [firstPhoto],
      }),
    ).resolves.toEqual({ match: false, notes: 'No text or photos remain' })

    expect(model.doGenerateCalls).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(
      'post https://t.me/example/51: skipped photo: expired file reference',
    )
    warn.mockRestore()
  })
})
