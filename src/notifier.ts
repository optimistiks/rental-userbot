import type { Verdict } from "./evaluator.js";
import type { Listing } from "./listing.js";
import type { ErrorReporter } from "./sentry.js";
import type { Telegram } from "./telegram.js";

import { createSentryReporter } from "./sentry.js";
import { watchingMessage } from "./watchlist.js";

/** Everything the bot writes to Saved Messages, and what happens when a write fails. */
interface Notifier {
  /** The 🟢 startup Notice. Throws: a bot that cannot reach Saved Messages should not run (ADR-0004). */
  started: (watchedChannels: number) => Promise<void>;
  /** An Owner files Notice seen on this Post's arrival. A failed write is logged and dropped. */
  notice: (notice: string, postLink: string) => Promise<void>;
  /**
   * Writes a Match or an Evaluation failure, nothing for No match, and logs the Verdict.
   * A failed write is logged and dropped, never retried (ADR-0002).
   */
  verdict: (listing: Pick<Listing, "link">, verdict: Verdict) => Promise<void>;
}

function createNotifier(
  telegram: Pick<Telegram, "sendToMe">,
  errorReporter: ErrorReporter = createSentryReporter(),
): Notifier {
  return {
    async notice(notice, postLink) {
      try {
        await telegram.sendToMe(notice);
      } catch (error) {
        console.error(`post ${postLink}: failed to send Notice`, error);
        errorReporter.captureException(error, { phase: "notice", postLink });
      }
    },
    async started(watchedChannels) {
      const notice = `🟢 started, ${watchingMessage(watchedChannels)}`;
      console.log(`startup: ${notice}`);
      await telegram.sendToMe(notice);
    },
    async verdict({ link }, verdict) {
      const message = messageFor(link, verdict);
      if (message !== undefined) {
        try {
          await telegram.sendToMe(message);
        } catch (error) {
          console.error(`post ${link}: failed to send notification`, error);
          errorReporter.captureException(error, { phase: "notification", postLink: link });
        }
      }

      console.log(`post ${link}: ${describeVerdict(verdict)}`);
    },
  };
}

function messageFor(link: string, verdict: Verdict): string | undefined {
  if (verdict.kind === "evaluation-failure") {
    return `${link}\n⚠️ couldn't evaluate: ${verdict.error}`;
  }

  return verdict.kind === "match" ? `${link}\n${verdict.notes}` : undefined;
}

function describeVerdict(verdict: Verdict): string {
  if (verdict.kind === "evaluation-failure") {
    return `Evaluation failure — ${verdict.error}`;
  }

  return `${verdict.kind === "match" ? "Match" : "No match"} — ${verdict.notes}`;
}

export { type Notifier, createNotifier };
