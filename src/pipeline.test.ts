import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

import { createEvaluator } from './evaluator.js'
import { createPostPipeline } from './pipeline.js'
import type { Post } from './telegram.js'

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function post(chatId: number, text: string, id: number): Post {
  return {
    chatId,
    messageIds: [id],
    text,
    photos: [],
    link: `https://t.me/example/${id}`,
  }
}

describe('Post pipeline', () => {
  it('evaluates watched text Posts, notifies Matches, and drops other Posts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(promptPath, 'Prompt')
    writeFileSync(criteriaPath, 'Criteria')
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [{ type: 'text', text: JSON.stringify({ match: true, notes: 'Looks good' }) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [{ type: 'text', text: JSON.stringify({ match: false, notes: 'Too expensive' }) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
        },
      ],
    })
    const telegram = { sendToMe: vi.fn(async () => undefined) }
    const evaluator = createEvaluator({
      modelId: 'test/model',
      promptPath,
      criteriaPath,
      model,
    })
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await pipeline.process(post(-1001234567890, 'Flat for rent', 1))
    await pipeline.process(post(-1001234567890, 'Another flat', 2))
    await pipeline.process(post(-1009876543210, 'Unwatched flat', 3))
    await pipeline.process(post(-1001234567890, '', 4))

    expect(telegram.sendToMe).toHaveBeenCalledOnce()
    expect(telegram.sendToMe).toHaveBeenCalledWith(
      'https://t.me/example/1\nLooks good',
    )
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(log).toHaveBeenCalledWith(
      'post https://t.me/example/1: Match — Looks good',
    )
    expect(log).toHaveBeenCalledWith(
      'post https://t.me/example/2: No match — Too expensive',
    )
    expect(log).toHaveBeenCalledWith(
      'post https://t.me/example/4: dropped empty Post',
    )
    log.mockRestore()
  })
})
