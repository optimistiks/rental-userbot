import * as Sentry from '@sentry/node'

export type SentryApi = Pick<
  typeof Sentry,
  | 'captureException'
  | 'experimentalUseDiagnosticsChannelInjection'
  | 'init'
  | 'startSpan'
  | 'withScope'
>

export type ErrorPhase = 'evaluation' | 'notification' | 'pipeline'

export interface ErrorContext {
  postLink?: string
  phase?: ErrorPhase
}

export interface ErrorReporter {
  readonly enabled: boolean
  run<T>(postLink: string, operation: () => Promise<T>): Promise<T>
  captureException(error: unknown, context?: ErrorContext): void
}

const disabledReporter: ErrorReporter = {
  enabled: false,
  run: (_postLink, operation) => operation(),
  captureException: () => undefined,
}

export function createSentryReporter(
  dsn: string | undefined,
  api: SentryApi = Sentry,
): ErrorReporter {
  if (dsn === undefined || dsn.trim() === '') {
    return disabledReporter
  }

  try {
    // The diagnostics-channel integration is the Sentry-supported path for ai@7.
    api.experimentalUseDiagnosticsChannelInjection()
    api.init({
      dsn,
      tracesSampleRate: 1,
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: true, outputs: true },
        stackFrameVariables: false,
      },
      beforeSend: (event) => sanitizeSentryValue(event) as typeof event,
      beforeSendSpan: (span) => {
        const data = { ...span.data }
        for (const key of Object.keys(data)) {
          if (key === 'http.url' || key === 'url.full' || key.endsWith('.path')) {
            data[key] = '[redacted]'
          }
        }
        return { ...span, data }
      },
    })
  } catch {
    // Sentry is strictly best-effort. The bot must work when the laptop is offline
    // or a DSN is malformed.
    return disabledReporter
  }

  const capturedErrors = new WeakSet<object>()

  return {
    enabled: true,
    run<T>(postLink: string, operation: () => Promise<T>) {
      // The span has to wrap the run to measure it, but Sentry must never change
      // the outcome: if startSpan itself fails, fall back to the bare operation,
      // reusing the started one so a Post is never evaluated twice.
      let started: Promise<T> | undefined
      const startOperation = () => (started = operation())

      try {
        return Promise.resolve(
          api.startSpan(
            {
              name: 'Evaluate Telegram Post',
              op: 'rental.evaluation',
              attributes: { 'telegram.post.link': postLink },
            },
            startOperation,
          ),
        )
      } catch {
        return started ?? operation()
      }
    },
    captureException(error, context) {
      if (typeof error === 'object' && error !== null) {
        if (capturedErrors.has(error)) {
          return
        }
        capturedErrors.add(error)
      }

      try {
        api.withScope((scope) => {
          if (context?.postLink !== undefined) {
            scope.setContext('post', { link: context.postLink })
          }
          if (context?.phase !== undefined) {
            scope.setTag('phase', context.phase)
          }
          api.captureException(error)
        })
      } catch {
        // Reporting must never change pipeline behavior.
      }
    },
  }
}

export function sanitizeSentryText(value: string): string {
  return value
    .replace(
      /([?&](?:key|token|api[_-]?key|authorization)=)[^&#\s]*/gi,
      '$1[redacted]',
    )
    .replace(
      /((?:authorization|proxy-authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|token|secret|password)\s*[:=]\s*(?:Bearer\s+)?)[^,\s;"'}]+/gi,
      '$1[redacted]',
    )
    .replace(/(?:data[\\/])?(?:session|bot)\.sqlite/gi, '[redacted database]')
}

const sensitiveKey = /(?:api[_-]?key|apikey|authorization|proxy-authorization|access[_-]?token|token|secret|password|session)/i

function sanitizeSentryValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === 'string') {
    return sanitizeSentryText(value)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const existing = seen.get(value)
  if (existing !== undefined) {
    return existing
  }

  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    seen.set(value, sanitized)
    for (const item of value) {
      sanitized.push(sanitizeSentryValue(item, seen))
    }
    return sanitized
  }

  const sanitized: Record<string, unknown> = {}
  seen.set(value, sanitized)
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = sensitiveKey.test(key) ? '[redacted]' : sanitizeSentryValue(item, seen)
  }
  return sanitized
}

let runtimeReporter: ErrorReporter = disabledReporter

export function initializeSentry(dsn: string | undefined): ErrorReporter {
  if (!runtimeReporter.enabled) {
    runtimeReporter = createSentryReporter(dsn)
  }
  return runtimeReporter
}
