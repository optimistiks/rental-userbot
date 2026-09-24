/* Composition root: every daemon collaborator is constructed here. */
// oxlint-disable import/max-dependencies
import type { LoginSettings, Settings } from "./config.js";
import type { ErrorReporter } from "./sentry.js";
import type { SessionLock } from "./session-lock.js";
import type { SessionClient, TelegramClientLike } from "./telegram.js";

import { readLoginSettings, readSettings } from "./config.js";
import { errorMessage } from "./errors.js";
import { createGeocoder } from "./geocoder.js";
import { createNotices } from "./notices.js";
import { createPostPipeline } from "./pipeline.js";
import { initializeSentry } from "./sentry.js";
import { acquireSessionLock } from "./session-lock.js";
import { announceStartup, initializeStartup } from "./startup.js";
import { createTelegramAdapter, createTelegramClient, startDaemonSession } from "./telegram.js";
import { createWatchlist } from "./watchlist.js";
import { createZoneChecker } from "./zone.js";

type ManagedClient = TelegramClientLike &
  SessionClient & {
    destroy: () => Promise<void>;
  };

type ClientFactory = (settings: Pick<Settings, "apiId" | "apiHash">) => ManagedClient;

async function runLogin(
  settings: LoginSettings,
  makeClient: ClientFactory = createTelegramClient,
  lock: SessionLock = acquireSessionLock(),
): Promise<void> {
  const client = makeClient(settings);

  try {
    await client.start();
  } finally {
    await client.destroy();
    lock.release();
  }
}

async function runDaemon(
  settings: Settings,
  makeClient: ClientFactory = createTelegramClient,
  databasePath?: string,
  errorReporter: ErrorReporter = initializeSentry(settings.sentryDsn),
  lock: SessionLock = acquireSessionLock(),
): Promise<void> {
  let resources: ReturnType<typeof initializeStartup> | undefined;
  let client: ManagedClient | undefined;

  try {
    resources = initializeStartup(settings, databasePath);
    const { createEvaluator, createEvaluatorTools } = await import("./evaluator.js");
    client = makeClient(settings);
    await startDaemonSession(client);
    const watchlist = createWatchlist(settings.channelsPath);
    const telegram = createTelegramAdapter(client, () => watchlist.channelIds());
    const notices = createNotices({
      channelsPath: settings.channelsPath,
      criteriaPath: settings.criteriaPath,
      promptPath: settings.promptPath,
      zonePath: settings.zonePath,
    });
    await announceStartup(telegram, watchlist.channelIds());
    const geocoder = createGeocoder({
      token: settings.locationIqToken,
      url: settings.geocoderUrl,
    });
    const zoneChecker = createZoneChecker(settings.zonePath);
    const pipeline = createPostPipeline({
      concurrency: settings.evaluationConcurrency,
      dedupeStore: resources.dedupeStore,
      errorReporter,
      evaluator: createEvaluator(settings, {
        downloadPhoto: telegram.downloadPhoto,
        errorReporter,
        tools: createEvaluatorTools({
          geocode: (query, signal) => geocoder.geocode(query, signal),
          inZone: (point) => zoneChecker.inZone(point),
        }),
      }),
      notices,
      telegram,
      watchlist,
    });
    telegram.onPost((post) => {
      /* The onPost callback returns void, so the pipeline promise is deliberately
         detached here and its failures are handled in place. */
      // oxlint-disable-next-line promise/prefer-await-to-then
      pipeline.process(post).catch((error: unknown) => {
        errorReporter.captureException(error, { phase: "pipeline", postLink: post.link });
        console.error(`post ${post.link}: pipeline failed`, error);
      });
    });
  } catch (error) {
    errorReporter.captureException(error);
    lock.release();
    resources?.dedupeStore.close();

    if (client !== undefined) {
      try {
        await client.destroy();
      } catch {
        // Preserve the startup error; the process is already failing.
      }
    }

    throw error;
  }
}

async function start(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let errorReporter: ErrorReporter | undefined;
  try {
    if (argv[2] === "login") {
      await runLogin(readLoginSettings(env));
    } else {
      const settings = readSettings(env);
      errorReporter = initializeSentry(settings.sentryDsn);
      await runDaemon(settings, createTelegramClient, undefined, errorReporter);
    }
  } catch (error) {
    if (argv[2] !== "login") {
      (errorReporter ?? initializeSentry(env.SENTRY_DSN)).captureException(error);
    }
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.filename === process.argv[1];

if (isEntrypoint) {
  // oxlint-disable-next-line no-void
  void start();
}

export { runLogin, runDaemon, start, type ClientFactory };
