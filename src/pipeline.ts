import { isWatchedPost } from './channel-filter.js'
import type { Evaluator } from './evaluator.js'
import type { Post, Telegram } from './telegram.js'

export interface PostPipeline {
  process(post: Post): Promise<void>
}

export interface PostPipelineOptions {
  channelIds: readonly number[]
  evaluator: Evaluator
  telegram: Pick<Telegram, 'sendToMe'>
}

export function createPostPipeline(options: PostPipelineOptions): PostPipeline {
  return {
    async process(post) {
      if (!isWatchedPost(post, options.channelIds)) {
        return
      }

      if (post.text.trim() === '' && post.photos.length === 0) {
        console.log(`post ${post.link}: dropped empty Post`)
        return
      }

      const verdict = await options.evaluator.evaluate(post)

      if (verdict.match) {
        await options.telegram.sendToMe(`${post.link}\n${verdict.notes}`)
      }

      logVerdict(post, verdict)
    },
  }
}

function logVerdict(
  post: Post,
  verdict: { match: boolean; notes: string },
): void {
  const label = verdict.match ? 'Match' : 'No match'
  console.log(`post ${post.link}: ${label} — ${verdict.notes}`)
}
