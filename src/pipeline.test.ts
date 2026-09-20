import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

import { createEvaluator } from './evaluator.js'
import { openDedupeStore } from './dedupe-store.js'
import { createPostPipeline } from './pipeline.js'
import type { PhotoRef, Post } from './telegram.js'

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
    const dedupeStore = openDedupeStore(':memory:')
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
      dedupeStore,
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
    dedupeStore.close()
  })

  it('evaluates an album once, sends its photos to the model, and drops a late part', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(promptPath, 'Prompt')
    writeFileSync(criteriaPath, 'Criteria')
    const firstPhoto = { __photoRef: true } as PhotoRef
    const secondPhoto = { __photoRef: true } as PhotoRef
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ match: true, notes: 'Looks good' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      },
    })
    const downloadPhoto = vi
      .fn<(photo: PhotoRef) => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]))
    const telegram = {
      sendToMe: vi.fn(async () => undefined),
      downloadPhoto,
    }
    const dedupeStore = openDedupeStore(':memory:')
    const evaluator = createEvaluator(
      { modelId: 'test/model', promptPath, criteriaPath, model },
      { downloadPhoto },
    )
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await pipeline.process({
      chatId: -1001234567890,
      messageIds: [60, 61],
      albumId: 'album-8',
      text: 'Flat with a balcony',
      photos: [firstPhoto, secondPhoto],
      link: 'https://t.me/example/60',
    })
    await pipeline.process({
      chatId: -1001234567890,
      messageIds: [62],
      albumId: 'album-8',
      text: 'Late album part',
      photos: [firstPhoto],
      link: 'https://t.me/example/62',
    })

    expect(downloadPhoto).toHaveBeenCalledTimes(2)
    expect(model.doGenerateCalls).toHaveLength(1)
    expect(telegram.sendToMe).toHaveBeenCalledOnce()
    expect(telegram.sendToMe).toHaveBeenCalledWith(
      'https://t.me/example/60\nLooks good',
    )
    log.mockRestore()
    dedupeStore.close()
  })

  it('marks a textless Post processed without an agent run when every photo fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rental-userbot-'))
    const promptPath = join(directory, 'prompt.md')
    const criteriaPath = join(directory, 'criteria.md')
    writeFileSync(promptPath, 'Prompt')
    writeFileSync(criteriaPath, 'Criteria')
    const photo = { __photoRef: true } as PhotoRef
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ match: true, notes: 'Should not run' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      },
    })
    const downloadPhoto = vi.fn(async () => {
      throw new Error('expired file reference')
    })
    const dedupeStore = openDedupeStore(':memory:')
    const evaluator = createEvaluator(
      { modelId: 'test/model', promptPath, criteriaPath, model },
      { downloadPhoto },
    )
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await pipeline.process({
      chatId: -1001234567890,
      messageIds: [70],
      text: '',
      photos: [photo],
      link: 'https://t.me/example/70',
    })

    expect(model.doGenerateCalls).toHaveLength(0)
    expect(dedupeStore.isProcessed('-1001234567890:70')).toBe(true)
    expect(log).toHaveBeenCalledWith(
      'post https://t.me/example/70: No match — No text or photos remain',
    )
    log.mockRestore()
    dedupeStore.close()
  })

  it('evaluates duplicate Posts delivered before the first one is marked only once', async () => {
    const dedupeStore = openDedupeStore(':memory:')
    let releaseFirst!: () => void
    const firstEvaluation = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const evaluator = {
      evaluate: vi.fn(async () => {
        await firstEvaluation
        return { match: false, notes: 'No match' }
      }),
    }
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const first = pipeline.process(post(-1001234567890, 'Flat for rent', 5))
    const duplicate = pipeline.process(post(-1001234567890, 'Flat for rent', 5))

    await vi.waitFor(() => expect(evaluator.evaluate).toHaveBeenCalledOnce())
    releaseFirst()
    await Promise.all([first, duplicate])

    expect(evaluator.evaluate).toHaveBeenCalledOnce()
    expect(dedupeStore.isProcessed('-1001234567890:5')).toBe(true)
    log.mockRestore()
    dedupeStore.close()
  })

  it('evaluates queued Posts one at a time', async () => {
    const dedupeStore = openDedupeStore(':memory:')
    let releaseFirst!: () => void
    const firstEvaluation = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let activeEvaluations = 0
    let maximumActiveEvaluations = 0
    const evaluationOrder: number[] = []
    const evaluator = {
      evaluate: vi.fn(async (post: Post) => {
        activeEvaluations += 1
        maximumActiveEvaluations = Math.max(maximumActiveEvaluations, activeEvaluations)
        evaluationOrder.push(post.messageIds[0])

        if (post.messageIds[0] === 6) {
          await firstEvaluation
        }

        activeEvaluations -= 1
        return { match: false, notes: 'No match' }
      }),
    }
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const first = pipeline.process(post(-1001234567890, 'First flat', 6))
    const second = pipeline.process(post(-1001234567890, 'Second flat', 7))

    await vi.waitFor(() => expect(evaluator.evaluate).toHaveBeenCalledOnce())
    expect(evaluationOrder).toEqual([6])
    releaseFirst()
    await Promise.all([first, second])

    expect(evaluationOrder).toEqual([6, 7])
    expect(maximumActiveEvaluations).toBe(1)
    log.mockRestore()
    dedupeStore.close()
  })

  it('does not re-evaluate a Processed Post across pipeline instances sharing a store', async () => {
    const dedupeStore = openDedupeStore(':memory:')
    const firstEvaluator = { evaluate: vi.fn(async () => ({ match: false, notes: 'No match' })) }
    const firstPipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator: firstEvaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const firstPost = post(-1001234567890, 'Already processed', 8)

    await firstPipeline.process(firstPost)

    const secondEvaluator = { evaluate: vi.fn(async () => ({ match: false, notes: 'No match' })) }
    const secondPipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator: secondEvaluator,
      telegram: { sendToMe: vi.fn(async () => undefined) },
      dedupeStore,
    })

    await secondPipeline.process(firstPost)

    expect(firstEvaluator.evaluate).toHaveBeenCalledOnce()
    expect(secondEvaluator.evaluate).not.toHaveBeenCalled()
    log.mockRestore()
    dedupeStore.close()
  })

  it('marks a Post after a failed notification so it is not retried', async () => {
    const dedupeStore = openDedupeStore(':memory:')
    const evaluator = {
      evaluate: vi.fn(async () => ({ match: true, notes: 'Looks good' })),
    }
    const telegram = {
      sendToMe: vi.fn(async () => {
        throw new Error('Saved Messages unavailable')
      }),
    }
    const pipeline = createPostPipeline({
      channelIds: [-1001234567890],
      evaluator,
      telegram,
      dedupeStore,
    })
    const postToProcess = post(-1001234567890, 'Flat for rent', 9)

    await expect(pipeline.process(postToProcess)).resolves.toBeUndefined()
    await pipeline.process(postToProcess)

    expect(evaluator.evaluate).toHaveBeenCalledOnce()
    expect(telegram.sendToMe).toHaveBeenCalledOnce()
    expect(dedupeStore.isProcessed('-1001234567890:9')).toBe(true)
    dedupeStore.close()
  })
})
