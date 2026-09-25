// oxlint-disable-next-line import/no-namespace
import * as Sentry from "@sentry/node";

type SentryApi = Pick<
  typeof Sentry,
  | "captureException"
  | "experimentalUseDiagnosticsChannelInjection"
  | "init"
  | "startSpan"
  | "withScope"
>;

type ErrorPhase = "evaluation" | "notice" | "notification" | "pipeline";

interface ErrorContext {
  postLink?: string;
  phase?: ErrorPhase;
}

interface ErrorReporter {
  readonly enabled: boolean;
  run: <T>(postLink: string, operation: () => Promise<T>) => Promise<T>;
  captureException: (error: unknown, context?: ErrorContext) => void;
}

const disabledReporter: ErrorReporter = {
  captureException: () => {
    /* The disabled reporter swallows everything. */
  },
  enabled: false,
  run: (_postLink, operation) => operation(),
};

function createSentryReporter(dsn?: string, api: SentryApi = Sentry): ErrorReporter {
  if (dsn === undefined || dsn.trim() === "") {
    return disabledReporter;
  }

  try {
    // The diagnostics-channel integration is the Sentry-supported path for ai@7.
    api.experimentalUseDiagnosticsChannelInjection();
    api.init({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      beforeSend: (event) => sanitizeSentryValue(event) as typeof event,
      beforeSendSpan: (span) => {
        const data = { ...span.data };
        for (const key of Object.keys(data)) {
          if (key === "http.url" || key === "url.full" || key.endsWith(".path")) {
            data[key] = "[redacted]";
          }
        }
        return { ...span, data };
      },
      dataCollection: {
        /* Inputs include every photo, resent on each agent step; holding them in
           spans until a trace flushes exhausted the heap once Listings ran concurrently. */
        genAI: { inputs: false, outputs: true },
        httpBodies: [],
        httpHeaders: false,
        stackFrameVariables: false,
        urlQueryParams: false,
        userInfo: false,
      },
      dsn,
      tracesSampleRate: 1,
    });
  } catch {
    // Sentry is strictly best-effort. The bot must work when the laptop is offline
    // Or a DSN is malformed.
    return disabledReporter;
  }

  return {
    captureException(error, context) {
      try {
        api.withScope((scope) => {
          if (context?.postLink !== undefined) {
            scope.setContext("post", { link: context.postLink });
          }
          if (context?.phase !== undefined) {
            scope.setTag("phase", context.phase);
          }
          api.captureException(error);
        });
      } catch {
        // Reporting must never change pipeline behavior.
      }
    },
    enabled: true,
    run<T>(postLink: string, operation: () => Promise<T>) {
      return api.startSpan(
        {
          attributes: { "telegram.post.link": postLink },
          name: "Evaluate Telegram Post",
          op: "rental.evaluation",
        },
        operation,
      );
    },
  };
}

function sanitizeSentryText(value: string): string {
  return value
    .replaceAll(
      /(?<prefix>[?&](?:key|token|api[_-]?key|authorization)=)[^&#\s]*/giu,
      "$<prefix>[redacted]",
    )
    .replaceAll(
      /(?<prefix>(?:authorization|proxy-authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|token|secret|password)\s*[:=]\s*(?:Bearer\s+)?)[^,\s;"'}]+/giu,
      "$<prefix>[redacted]",
    )
    .replaceAll(/(?:data[\\/])?(?:session|bot)\.sqlite/giu, "[redacted database]");
}

const sensitiveKey =
  /(?:api[_-]?key|apikey|authorization|proxy-authorization|access[_-]?token|token|secret|password|session)/iu;

function sanitizeSentryValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === "string") {
    return sanitizeSentryText(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }

  if (Array.isArray(value)) {
    const sanitized: unknown[] = [];
    seen.set(value, sanitized);
    for (const item of value) {
      sanitized.push(sanitizeSentryValue(item, seen));
    }
    return sanitized;
  }

  const sanitized: Record<string, unknown> = {};
  seen.set(value, sanitized);
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = sensitiveKey.test(key) ? "[redacted]" : sanitizeSentryValue(item, seen);
  }
  return sanitized;
}

export { type SentryApi, type ErrorReporter, createSentryReporter, sanitizeSentryText };
