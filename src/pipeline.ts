import type { DedupeStore } from "./dedupe-store.js";
import type { EvaluationContext, EvaluationFailure, Evaluator, Verdict } from "./evaluator.js";
import type { Notices } from "./notices.js";
import type { ErrorReporter } from "./sentry.js";
import type { Post, Telegram } from "./telegram.js";
import type { Watchlist } from "./watchlist.js";

import { isWatchedPost } from "./channel-filter.js";
import { MIN_LISTING_PHOTOS } from "./config.js";
import { postKey } from "./dedupe-store.js";
import { evaluationFailure } from "./evaluator.js";
import { createSentryReporter } from "./sentry.js";

interface PostPipeline {
  process: (post: Post) => Promise<void>;
}

interface PostPipelineOptions {
  watchlist: Watchlist;
  evaluator: Evaluator;
  telegram: Pick<Telegram, "sendToMe">;
  dedupeStore: DedupeStore;
  notices?: Notices;
  errorReporter?: ErrorReporter;
}

function createPostPipeline(options: PostPipelineOptions): PostPipeline {
  let queueTail = Promise.resolve();
  // Listings queued but not yet started, logged when each one starts so a growing backlog shows.
  let waiting = 0;
  const errorReporter = options.errorReporter ?? createSentryReporter();

  return {
    process(post) {
      // The watchlist is re-read here, so an edit to the file takes effect on this Post.
      const channelIds = options.watchlist.channelIds();
      const noticePull = options.notices?.pull() ?? { canEvaluate: true };
      const noticeSend = deliverNotice(post, noticePull.notice, options, errorReporter);

      if (!noticePull.canEvaluate) {
        return noticeSend;
      }

      if (!isWatchedPost(post, channelIds)) {
        return noticeSend;
      }

      if (!isListing(post)) {
        console.log(`post ${post.link}: skipped — ${describeSkip(post)}`);
        return noticeSend;
      }

      const processedPostKey = postKey(post);
      if (options.dedupeStore.isProcessed(processedPostKey)) {
        return noticeSend;
      }

      /* The queue is a promise chain on purpose: process() must return at once
         while each post still runs strictly after the previous one. */
      waiting += 1;
      const queuedAt = Date.now();
      // oxlint-disable-next-line promise/prefer-await-to-then
      const queued = queueTail.then(async () => {
        waiting -= 1;
        await noticeSend;
        return processQueuedPost(
          post,
          processedPostKey,
          { waitedMs: Date.now() - queuedAt, waiting },
          options,
          errorReporter,
        );
      });
      // oxlint-disable-next-line promise/prefer-await-to-then
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
  context: EvaluationContext,
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
    verdict = await options.evaluator.evaluate(post, context);
  } catch (error) {
    console.error(`post ${post.link}: evaluation threw`, error);
    errorReporter.captureException(error, { phase: "evaluation", postLink: post.link });
    verdict = evaluationFailure(error);
  }

  try {
    const notification = notificationFor(post, verdict);
    if (notification !== undefined) {
      await options.telegram.sendToMe(notification);
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

async function deliverNotice(
  post: Post,
  notice: string | undefined,
  options: PostPipelineOptions,
  errorReporter: ErrorReporter,
): Promise<void> {
  if (notice === undefined) {
    return;
  }

  try {
    await options.telegram.sendToMe(notice);
  } catch (error) {
    console.error(`post ${post.link}: failed to send Notice`, error);
    errorReporter.captureException(error, { phase: "notice", postLink: post.link });
  }
}

function isListing(post: Post): boolean {
  return post.text.trim() !== "" && post.photos.length >= MIN_LISTING_PHOTOS;
}

function describeSkip(post: Post): string {
  const count = post.photos.length;
  const photos = `${count} photo${count === 1 ? "" : "s"}`;
  return post.text.trim() === "" ? `${photos}, no text` : photos;
}

function isEvaluationFailure(verdict: Verdict): verdict is EvaluationFailure {
  return "kind" in verdict && verdict.kind === "evaluation-failure";
}

export { type PostPipeline, type PostPipelineOptions, createPostPipeline };
