/* Composition root: every daemon collaborator is constructed here. */
// oxlint-disable import/max-dependencies
import type { LoginSettings, Settings } from "./config.js";
import type { ProcessedPosts } from "./processed-posts.js";
import type { ErrorReporter } from "./sentry.js";
import type { SessionLock } from "./session-lock.js";
import type { SessionClient, TelegramClientLike } from "./telegram.js";

import { readLoginSettings, readSettings } from "./config.js";
import { errorMessage } from "./errors.js";
import { createEvaluator } from "./evaluator.js";
import { createLocator } from "./locator.js";
import { createNotifier } from "./notifier.js";
import { openOwnerFiles } from "./owner-files.js";
import { createPostPipeline } from "./pipeline.js";
import { openProcessedPosts } from "./processed-posts.js";
import { createSentryReporter } from "./sentry.js";
import { acquireSessionLock } from "./session-lock.js";
import { createTelegramAdapter, createTelegramClient, daemonStartParams } from "./telegram.js";

type ManagedClient = TelegramClientLike &
  SessionClient & {
    destroy: () => Promise<void>;
  };

type ClientFactory = (settings: LoginSettings) => ManagedClient;

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
  errorReporter: ErrorReporter,
  makeClient: ClientFactory = createTelegramClient,
  databasePath?: string,
  lock: SessionLock = acquireSessionLock(),
): Promise<void> {
  let processedPosts: ProcessedPosts | undefined;
  let client: ManagedClient | undefined;

  try {
    const ownerFiles = openOwnerFiles(settings);
    processedPosts = openProcessedPosts(databasePath);
    client = makeClient(settings);
    await client.start(daemonStartParams);
    const telegram = createTelegramAdapter(client, ownerFiles.watchedChannelIds);
    const notifier = createNotifier(telegram, errorReporter);
    await notifier.started(ownerFiles.watchedAtStartup);
    const pipeline = createPostPipeline({
      concurrency: settings.evaluationConcurrency,
      downloadPhoto: telegram.downloadPhoto,
      evaluator: createEvaluator(settings, {
        errorReporter,
        locator: createLocator(settings),
      }),
      notifier,
      ownerFiles,
      processedPosts,
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
    lock.release();
    processedPosts?.close();

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
  const errorReporter =
    argv[2] === "login" ? undefined : createSentryReporter(env.SENTRY_DSN?.trim());
  try {
    await (errorReporter === undefined
      ? runLogin(readLoginSettings(env))
      : runDaemon(readSettings(env), errorReporter));
  } catch (error) {
    errorReporter?.captureException(error);
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
