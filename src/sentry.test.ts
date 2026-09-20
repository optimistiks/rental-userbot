import type { Mock } from "vitest";

import { describe, expect, it, vi } from "vitest";

import type { SentryApi } from "./sentry.js";

import { createSentryReporter, sanitizeSentryText } from "./sentry.js";

interface FakeSentry {
  captureException: Mock<SentryApi["captureException"]>;
  events: string[];
  experimentalUseDiagnosticsChannelInjection: Mock<
    SentryApi["experimentalUseDiagnosticsChannelInjection"]
  >;
  init: Mock<SentryApi["init"]>;
  readonly initOptions: Record<string, unknown> | undefined;
  scopeContext: Mock<(name: string, context: unknown) => void>;
  startSpan: Mock<(options: unknown, callback: (span: unknown) => unknown) => unknown>;
  withScope: Mock<(callback: (scope: unknown) => unknown) => unknown>;
}

function fakeSentry(): FakeSentry {
  const events: string[] = [];
  const scopeContext = vi.fn<(name: string, context: unknown) => void>();
  let initOptions: Record<string, unknown> | undefined;

  return {
    captureException: vi.fn<SentryApi["captureException"]>(),
    events,
    experimentalUseDiagnosticsChannelInjection: vi.fn<
      SentryApi["experimentalUseDiagnosticsChannelInjection"]
    >(() => {
      events.push("prepare");
    }),
    init: vi.fn<SentryApi["init"]>((options) => {
      initOptions = options as Record<string, unknown>;
      events.push("init");
      return undefined as ReturnType<SentryApi["init"]>;
    }),
    get initOptions(): Record<string, unknown> | undefined {
      return initOptions;
    },
    scopeContext,
    // Sentry types startSpan and withScope generically and vitest's Mock cannot
    // Carry a type parameter, so both are mocked at the shape the reporter uses
    // And the object is widened to SentryApi where it is handed over.
    startSpan: vi.fn<(options: unknown, callback: (span: unknown) => unknown) => unknown>(
      (_options, callback) => callback({}),
    ),
    withScope: vi.fn<(callback: (scope: unknown) => unknown) => unknown>((callback) =>
      callback({ setContext: scopeContext }),
    ),
  };
}

/** Runs the span body, then fails the span the way Sentry would on a thrown error. */
function failAfterCalling(callback: (span: unknown) => unknown): never {
  /* Not a Node error-first callback; it is the span body Sentry invokes. */
  // oxlint-disable-next-line node/callback-return
  callback({});
  throw new Error("span failed");
}

describe("sentry reporter", () => {
  it("does nothing when SENTRY_DSN is unset", async () => {
    expect.hasAssertions();
    const sentry = fakeSentry();
    const reporter = createSentryReporter(undefined, sentry as unknown as SentryApi);
    const operation = vi.fn<() => Promise<string>>(() => Promise.resolve("done"));

    await expect(reporter.run("https://t.me/example/1", operation)).resolves.toBe("done");

    expect(reporter.enabled).toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.startSpan).not.toHaveBeenCalled();
  });

  it("initializes tracing and captures agent inputs and outputs when enabled", async () => {
    expect.hasAssertions();
    const sentry = fakeSentry();
    const reporter = createSentryReporter(
      "https://public@example.com/1",
      sentry as unknown as SentryApi,
    );

    await expect(
      reporter.run("https://t.me/example/2", () => Promise.resolve("done")),
    ).resolves.toBe("done");
    reporter.captureException(new Error("failed"), { postLink: "https://t.me/example/2" });

    expect(reporter.enabled).toBe(true);
    expect(sentry.events).toStrictEqual(["prepare", "init"]);
    expect(sentry.initOptions).toMatchObject({
      dataCollection: {
        genAI: { inputs: true, outputs: true },
        httpBodies: [],
        httpHeaders: false,
        urlQueryParams: false,
      },
      dsn: "https://public@example.com/1",
      tracesSampleRate: 1,
    });
    expect(sentry.startSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: { "telegram.post.link": "https://t.me/example/2" },
        name: "Evaluate Telegram Post",
      }),
      expect.any(Function),
    );
    expect(sentry.scopeContext).toHaveBeenCalledWith("post", {
      link: "https://t.me/example/2",
    });
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error));

    const beforeSend = sentry.initOptions?.beforeSend as (event: unknown) => unknown;
    const sanitizedEvent = beforeSend({
      extra: { AI_GATEWAY_API_KEY: "secret", session: "data/session.sqlite" },
      message: "failed https://example.test?key=secret",
      request: { headers: { authorization: "Bearer secret", "x-api-key": "secret" } },
    });
    expect(sanitizedEvent).toStrictEqual({
      extra: { AI_GATEWAY_API_KEY: "[redacted]", session: "[redacted]" },
      message: "failed https://example.test?key=[redacted]",
      request: { headers: { authorization: "[redacted]", "x-api-key": "[redacted]" } },
    });

    const beforeSendSpan = sentry.initOptions?.beforeSendSpan as (span: unknown) => unknown;
    expect(
      beforeSendSpan({
        data: {
          "http.url": "https://example.test?key=secret",
          "request.path": "data/session.sqlite",
        },
      }),
    ).toStrictEqual({
      data: { "http.url": "[redacted]", "request.path": "[redacted]" },
    });
  });

  it("falls back to disabled reporting if Sentry initialization fails", () => {
    expect.hasAssertions();
    const sentry = fakeSentry();
    sentry.init.mockImplementation(() => {
      throw new Error("offline");
    });

    expect(() =>
      createSentryReporter("https://public@example.com/1", sentry as unknown as SentryApi),
    ).not.toThrow();
  });

  it("does not let a span lifecycle failure block or duplicate the operation", async () => {
    expect.hasAssertions();
    const sentry = fakeSentry();
    const operation = vi.fn<() => Promise<string>>(() => Promise.resolve("done"));
    sentry.startSpan.mockImplementation((_options, callback) => failAfterCalling(callback));
    const reporter = createSentryReporter(
      "https://public@example.com/1",
      sentry as unknown as SentryApi,
    );

    await expect(reporter.run("https://t.me/example/3", operation)).resolves.toBe("done");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("scrubs credentials and database paths before sending error data", () => {
    expect.hasAssertions();
    const value =
      "https://eu1.locationiq.com/v1/search?key=secret&x=1 Authorization: Bearer key data/session.sqlite";

    expect(sanitizeSentryText(value)).toBe(
      "https://eu1.locationiq.com/v1/search?key=[redacted]&x=1 Authorization: Bearer [redacted] [redacted database]",
    );
    expect(sanitizeSentryText(value)).not.toContain("secret");
    expect(sanitizeSentryText(value)).not.toContain("session.sqlite");
  });
});
