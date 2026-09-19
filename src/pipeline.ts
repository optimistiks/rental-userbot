import { isWatchedPost } from './channel-filter.js'
import { postKey, type DedupeStore } from './dedupe-store.js'
import type { Evaluator } from './evaluator.js'
import type { Post, Telegram } from './telegram.js'

export interface PostPipeline {
  process(post: Post): Promise<void>
}

export interface PostPipelineOptions {
  channelIds: readonly number[]
  evaluator: Evaluator
  telegram: Pick<Telegram, 'sendToMe'>
  dedupeStore: DedupeStore
}

export function createPostPipeline(options: PostPipelineOptions): PostPipeline {
  let queueTail = Promise.resolve()

  return {
    process(post) {
      if (!isWatchedPost(post, options.channelIds)) {
        return Promise.resolve()
      }

      if (post.text.trim() === '' && post.photos.length === 0) {
        console.log(`post ${post.link}: dropped empty Post`)
        return Promise.resolve()
      }

      const processedPostKey = postKey(post)
      if (options.dedupeStore.isProcessed(processedPostKey)) {
        return Promise.resolve()
      }

      const queued = queueTail.then(() =>
        processQueuedPost(post, processedPostKey, options),
      )
      queueTail = queued.catch(() => undefined)
      return queued
    },
  }
}

async function processQueuedPost(
  post: Post,
  processedPostKey: string,
  options: PostPipelineOptions,
): Promise<void> {
  if (options.dedupeStore.isProcessed(processedPostKey)) {
    return
  }

  const verdict = await options.evaluator.evaluate(post)

  try {
    if (verdict.match) {
      await options.telegram.sendToMe(`${post.link}\n${verdict.notes}`)
    }
  } finally {
    options.dedupeStore.markProcessed(processedPostKey)
  }

  logVerdict(post, verdict)
}

function logVerdict(
  post: Post,
  verdict: { match: boolean; notes: string },
): void {
  const label = verdict.match ? 'Match' : 'No match'
  console.log(`post ${post.link}: ${label} — ${verdict.notes}`)
}
