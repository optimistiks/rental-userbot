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
      const { log, message } = describeVerdict(link, verdict);
      if (message !== undefined) {
        try {
          await telegram.sendToMe(message);
        } catch (error) {
          console.error(`post ${link}: failed to send notification`, error);
          errorReporter.captureException(error, { phase: "notification", postLink: link });
        }
      }

      console.log(`post ${link}: ${log}`);
    },
  };
}

/** The log line for a Verdict, and the Saved Messages write if the owner should see it. */
function describeVerdict(link: string, verdict: Verdict): { log: string; message?: string } {
  switch (verdict.kind) {
    case "match": {
      return { log: `Match — ${verdict.notes}`, message: `${link}\n${verdict.notes}` };
    }
    case "no-match": {
      return { log: `No match — ${verdict.notes}` };
    }
    case "evaluation-failure": {
      return {
        log: `Evaluation failure — ${verdict.error}`,
        message: `${link}\n⚠️ couldn't evaluate: ${verdict.error}`,
      };
    }
    default: {
      // A Verdict kind added without a case here fails to compile.
      const unhandled: never = verdict;
      throw new Error(`unhandled Verdict: ${JSON.stringify(unhandled)}`);
    }
  }
}

export { type Notifier, createNotifier };
