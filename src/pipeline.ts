import type { DedupeStore } from "./dedupe-store.js";
import type { EvaluationContext, EvaluationFailure, Evaluator, Verdict } from "./evaluator.js";
import type { Notices } from "./notices.js";
import type { ErrorReporter } from "./sentry.js";
import type { Post, Telegram } from "./telegram.js";

import { MIN_LISTING_PHOTOS } from "./config.js";
import { postKey } from "./dedupe-store.js";
import { evaluationFailure } from "./evaluator.js";
import { createSentryReporter } from "./sentry.js";

interface PostPipeline {
  process: (post: Post) => Promise<void>;
}

/** Posts reach the pipeline already filtered to the Watchlist by the Telegram adapter. */
interface PostPipelineOptions {
  evaluator: Evaluator;
  telegram: Pick<Telegram, "sendToMe">;
  dedupeStore: DedupeStore;
  notices?: Notices;
  errorReporter?: ErrorReporter;
  /** How many Listings are evaluated at once. Telegram calls stay one at a time in the adapter. */
  concurrency?: number;
}

function createPostPipeline(options: PostPipelineOptions): PostPipeline {
  const concurrency = options.concurrency ?? 1;
  let running = 0;
  // One start callback per Listing queued but not yet started; its length is logged so a growing backlog shows.
  const slotWaiters: (() => void)[] = [];
  // Posts queued or running, so a second copy never takes a slot or runs alongside the first.
  const inFlight = new Set<string>();
  const errorReporter = options.errorReporter ?? createSentryReporter();

  async function takeSlot(): Promise<void> {
    if (running < concurrency) {
      running += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      slotWaiters.push(resolve);
    });
  }

  // A freed slot passes straight to the oldest waiting Listing, so start order stays FIFO.
  function releaseSlot(): void {
    const startOldest = slotWaiters.shift();
    if (startOldest === undefined) {
      running -= 1;
    } else {
      startOldest();
    }
  }

  async function runQueued(
    post: Post,
    processedPostKey: string,
    noticeSend: Promise<void>,
  ): Promise<void> {
    const queuedAt = Date.now();
    await takeSlot();
    try {
      await noticeSend;
      await processQueuedPost(
        post,
        processedPostKey,
        { waitedMs: Date.now() - queuedAt, waiting: slotWaiters.length },
        options,
        errorReporter,
      );
    } finally {
      inFlight.delete(processedPostKey);
      releaseSlot();
    }
  }

  return {
    process(post) {
      const noticePull = options.notices?.pull() ?? { canEvaluate: true };
      const noticeSend = deliverNotice(post, noticePull.notice, options, errorReporter);

      if (!noticePull.canEvaluate) {
        return noticeSend;
      }

      if (!isListing(post)) {
        console.log(`post ${post.link}: skipped — ${describeSkip(post)}`);
        return noticeSend;
      }

      const processedPostKey = postKey(post);
      if (options.dedupeStore.isProcessed(processedPostKey) || inFlight.has(processedPostKey)) {
        return noticeSend;
      }

      inFlight.add(processedPostKey);
      return runQueued(post, processedPostKey, noticeSend);
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

export { type PostPipeline, createPostPipeline };
