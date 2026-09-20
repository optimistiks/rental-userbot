import type { DedupeStore } from "./dedupe-store.js";
import type { EvaluationFailure, Evaluator, Verdict } from "./evaluator.js";
import type { ErrorReporter } from "./sentry.js";
import type { Post, Telegram } from "./telegram.js";

import { isWatchedPost } from "./channel-filter.js";
import { postKey } from "./dedupe-store.js";
import { evaluationFailure } from "./evaluator.js";
import { createSentryReporter } from "./sentry.js";

interface PostPipeline {
  process: (post: Post) => Promise<void>;
}

interface PostPipelineOptions {
  channelIds: readonly number[];
  evaluator: Evaluator;
  telegram: Pick<Telegram, "sendToMe">;
  dedupeStore: DedupeStore;
  errorReporter?: ErrorReporter;
}

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

function createPostPipeline(options: PostPipelineOptions): PostPipeline {
  let queueTail = Promise.resolve();
  const errorReporter = options.errorReporter ?? createSentryReporter();

  return {
    process(post) {
      if (!isWatchedPost(post, options.channelIds)) {
        return Promise.resolve();
      }

      if (post.text.trim() === "" && post.photos.length === 0) {
        console.log(`post ${post.link}: dropped empty Post`);
        return Promise.resolve();
      }

      const processedPostKey = postKey(post);
      if (options.dedupeStore.isProcessed(processedPostKey)) {
        return Promise.resolve();
      }

      const queued = queueTail.then(() =>
        processQueuedPost(post, processedPostKey, options, errorReporter),
      );
      queueTail = queued.catch(() => {
        /* Failures are reported per post; the queue keeps going. */
      });
      return queued;
    },
  };
}

async function processQueuedPost(
  post: Post,
  processedPostKey: string,
  options: PostPipelineOptions,
  errorReporter: ErrorReporter,
): Promise<void> {
  if (options.dedupeStore.isProcessed(processedPostKey)) {
    return;
  }

  // The Evaluator turns its own failures into a Verdict; an unexpected throw must
  // Still reach the Notifier and be marked processed, so nothing is silently lost.
  let verdict: Verdict;
  try {
    verdict = await options.evaluator.evaluate(post);
  } catch (error) {
    console.error(`post ${post.link}: evaluation threw`, error);
    errorReporter.captureException(error, { phase: "evaluation", postLink: post.link });
    verdict = evaluationFailure(error);
  }

  try {
    const notification = notificationFor(post, verdict);
    if (notification !== undefined) {
      await options.telegram.sendToMe(truncateTelegramMessage(notification));
    }
  } catch (error) {
    console.error(`post ${post.link}: failed to send notification`, error);
    errorReporter.captureException(error, { phase: "notification", postLink: post.link });
  } finally {
    options.dedupeStore.markProcessed(processedPostKey);
  }

  logVerdict(post, verdict);
}

function logVerdict(post: Post, verdict: Verdict): void {
  if (isEvaluationFailure(verdict)) {
    console.log(`post ${post.link}: Evaluation failure — ${verdict.error}`);
    return;
  }

  const label = verdict.match ? "Match" : "No match";
  console.log(`post ${post.link}: ${label} — ${verdict.notes}`);
}

function notificationFor(post: Post, verdict: Verdict): string | undefined {
  if (isEvaluationFailure(verdict)) {
    return `${post.link}\n⚠️ couldn't evaluate: ${verdict.error}`;
  }

  return verdict.match ? `${post.link}\n${verdict.notes}` : undefined;
}

function isEvaluationFailure(verdict: Verdict): verdict is EvaluationFailure {
  return "kind" in verdict && verdict.kind === "evaluation-failure";
}

function truncateTelegramMessage(message: string): string {
  return message.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
}

export {
  type PostPipeline,
  type PostPipelineOptions,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  createPostPipeline,
};
