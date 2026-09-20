import { describe, expect, it, vi } from 'vitest'

import { createSentryReporter, sanitizeSentryText, type SentryApi } from './sentry.js'

function fakeSentry() {
  const events: string[] = []
  const scopeContext = vi.fn()
  let initOptions: Record<string, unknown> | undefined

  return {
    events,
    get initOptions() {
      return initOptions
    },
    scopeContext,
    experimentalUseDiagnosticsChannelInjection: vi.fn(() => events.push('prepare')),
    init: vi.fn((options: Parameters<SentryApi['init']>[0]) => {
      initOptions = options as Record<string, unknown>
      events.push('init')
      return undefined as ReturnType<SentryApi['init']>
    }),
    withScope: vi.fn((callback) => callback({ setContext: scopeContext } as never)),
    captureException: vi.fn(),
    startSpan: vi.fn((_options, callback) => callback({} as never)),
  }
}

describe('Sentry reporter', () => {
  it('does nothing when SENTRY_DSN is unset', async () => {
    const sentry = fakeSentry()
    const reporter = createSentryReporter(undefined, sentry as unknown as SentryApi)
    const operation = vi.fn(async () => 'done')

    await expect(reporter.run('https://t.me/example/1', operation)).resolves.toBe('done')

    expect(reporter.enabled).toBe(false)
    expect(operation).toHaveBeenCalledOnce()
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.startSpan).not.toHaveBeenCalled()
  })

  it('initializes tracing and captures agent inputs and outputs when enabled', async () => {
    const sentry = fakeSentry()
    const reporter = createSentryReporter('https://public@example.com/1', sentry as unknown as SentryApi)

    await expect(reporter.run('https://t.me/example/2', async () => 'done')).resolves.toBe('done')
    reporter.captureException(new Error('failed'), { postLink: 'https://t.me/example/2' })

    expect(reporter.enabled).toBe(true)
    expect(sentry.events).toEqual(['prepare', 'init'])
    expect(sentry.initOptions).toMatchObject({
      dsn: 'https://public@example.com/1',
      tracesSampleRate: 1,
      sendDefaultPii: false,
      dataCollection: {
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: true, outputs: true },
      },
    })
    expect(sentry.startSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Evaluate Telegram Post',
        attributes: { 'telegram.post.link': 'https://t.me/example/2' },
      }),
      expect.any(Function),
    )
    expect(sentry.scopeContext).toHaveBeenCalledWith('post', {
      link: 'https://t.me/example/2',
    })
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error))

    const beforeSend = sentry.initOptions?.beforeSend as (event: unknown) => unknown
    const sanitizedEvent = beforeSend({
      message: 'failed https://example.test?key=secret',
      request: { headers: { authorization: 'Bearer secret', 'x-api-key': 'secret' } },
      extra: { AI_GATEWAY_API_KEY: 'secret', session: 'data/session.sqlite' },
    })
    expect(sanitizedEvent).toEqual({
      message: 'failed https://example.test?key=[redacted]',
      request: { headers: { authorization: '[redacted]', 'x-api-key': '[redacted]' } },
      extra: { AI_GATEWAY_API_KEY: '[redacted]', session: '[redacted]' },
    })

    const beforeSendSpan = sentry.initOptions?.beforeSendSpan as (span: unknown) => unknown
    expect(beforeSendSpan({ data: { 'http.url': 'https://example.test?key=secret', 'request.path': 'data/session.sqlite' } })).toEqual({
      data: { 'http.url': '[redacted]', 'request.path': '[redacted]' },
    })
  })

  it('falls back to disabled reporting if Sentry initialization fails', () => {
    const sentry = fakeSentry()
    sentry.init.mockImplementation(() => {
      throw new Error('offline')
    })

    expect(() => createSentryReporter('https://public@example.com/1', sentry as unknown as SentryApi)).not.toThrow()
  })

  it('does not let a span lifecycle failure block or duplicate the operation', async () => {
    const sentry = fakeSentry()
    const operation = vi.fn(async () => 'done')
    sentry.startSpan.mockImplementation((_options, callback) => {
      const result = callback({} as never)
      throw new Error('span failed')
      return result
    })
    const reporter = createSentryReporter('https://public@example.com/1', sentry as unknown as SentryApi)

    await expect(reporter.run('https://t.me/example/3', operation)).resolves.toBe('done')
    expect(operation).toHaveBeenCalledOnce()
  })

  it('scrubs credentials and database paths before sending error data', () => {
    const value = 'https://eu1.locationiq.com/v1/search?key=secret&x=1 Authorization: Bearer key data/session.sqlite'

    expect(sanitizeSentryText(value)).toBe(
      'https://eu1.locationiq.com/v1/search?key=[redacted]&x=1 Authorization: Bearer [redacted] [redacted database]',
    )
    expect(sanitizeSentryText(value)).not.toContain('secret')
    expect(sanitizeSentryText(value)).not.toContain('session.sqlite')
  })
})
