import type { Evaluator } from "./evaluator.js";
import type { Listing } from "./listing.js";
import type { Notifier } from "./notifier.js";
import type { OwnerFileContents, OwnerFiles } from "./owner-files.js";
import type { ProcessedPosts } from "./processed-posts.js";
import type { Post, Telegram } from "./telegram.js";

import { readListing } from "./listing.js";

interface PostPipeline {
  process: (post: Post) => Promise<void>;
}

/** Posts reach the pipeline already filtered to the Watchlist by the Telegram adapter. */
interface PostPipelineOptions {
  evaluator: Evaluator;
  notifier: Pick<Notifier, "notice" | "verdict">;
  downloadPhoto: Telegram["downloadPhoto"];
  processedPosts: Pick<ProcessedPosts, "once">;
  ownerFiles: Pick<OwnerFiles, "read">;
  /** How many Listings are evaluated at once. Telegram calls stay one at a time in the adapter. */
  concurrency?: number;
}

function createPostPipeline(options: PostPipelineOptions): PostPipeline {
  const concurrency = options.concurrency ?? 1;
  let running = 0;
  // One start callback per Listing queued but not yet started; its length is logged so a growing backlog shows.
  const slotWaiters: (() => void)[] = [];

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
    listing: Listing,
    ownerFiles: OwnerFileContents,
    noticeSend: Promise<void>,
  ): Promise<void> {
    const queuedAt = Date.now();
    await takeSlot();
    try {
      // A Notice seen on this Post's arrival reaches Saved Messages before its Verdict.
      await noticeSend;
      const verdict = await options.evaluator.evaluate(listing, ownerFiles, {
        waitedMs: Date.now() - queuedAt,
        waiting: slotWaiters.length,
      });
      await options.notifier.verdict(listing, verdict);
    } finally {
      releaseSlot();
    }
  }

  return {
    async process(post) {
      const { contents, notice } = options.ownerFiles.read();
      const noticeSend =
        notice === undefined ? Promise.resolve() : options.notifier.notice(notice, post.link);

      if (contents !== undefined) {
        const read = readListing(post, options.downloadPhoto);
        if ("skipped" in read) {
          console.log(`post ${post.link}: skipped — ${read.skipped}`);
        } else {
          // Claimed now, before waiting for a slot, so a duplicate never queues behind it.
          await options.processedPosts.once(post, () =>
            runQueued(read.listing, contents, noticeSend),
          );
        }
      }

      await noticeSend;
    },
  };
}

export { type PostPipeline, type PostPipelineOptions, createPostPipeline };
