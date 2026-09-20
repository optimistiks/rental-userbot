import { fileURLToPath } from 'node:url'

import { readLoginSettings, readSettings, type LoginSettings, type Settings } from './config.js'
import {
  createTelegramAdapter,
  createTelegramClient,
  startDaemonSession,
  type SessionClient,
  type TelegramClientLike,
} from './telegram.js'
import { errorMessage } from './errors.js'
import { createGeocoder } from './geocoder.js'
import { createPostPipeline } from './pipeline.js'
import { initializeSentry, type ErrorReporter } from './sentry.js'
import { announceStartup, initializeStartup } from './startup.js'
import { createZoneChecker } from './zone.js'

type ManagedClient = TelegramClientLike & SessionClient & {
  destroy(): Promise<void>
}

type ClientFactory = (settings: Pick<Settings, 'apiId' | 'apiHash'>) => ManagedClient

export async function runLogin(
  settings: LoginSettings,
  makeClient: ClientFactory = createTelegramClient,
): Promise<void> {
  const client = makeClient(settings)

  try {
    await client.start()
  } finally {
    await client.destroy()
  }
}

export async function runDaemon(
  settings: Settings,
  makeClient: ClientFactory = createTelegramClient,
  databasePath?: string,
  errorReporter: ErrorReporter = initializeSentry(settings.sentryDsn),
): Promise<void> {
  let resources: ReturnType<typeof initializeStartup> | undefined
  let client: ManagedClient | undefined

  try {
    resources = initializeStartup(settings, databasePath)
    const { createEvaluator, createEvaluatorTools } = await import('./evaluator.js')
    client = makeClient(settings)
    await startDaemonSession(client)
    const telegram = createTelegramAdapter(client)
    await announceStartup(telegram, settings.channelIds)
    const geocoder = createGeocoder({
      url: settings.geocoderUrl,
      token: settings.locationIqToken,
    })
    const zoneChecker = createZoneChecker(settings.zonePath)
    const pipeline = createPostPipeline({
      channelIds: settings.channelIds,
      evaluator: createEvaluator(settings, {
        downloadPhoto: telegram.downloadPhoto,
        tools: createEvaluatorTools({
          geocode: (query, signal) => geocoder.geocode(query, signal),
          inZone: (point) => zoneChecker.inZone(point),
        }),
        errorReporter,
      }),
      telegram,
      dedupeStore: resources.dedupeStore,
      errorReporter,
    })
    telegram.onPost((post) => {
      void pipeline.process(post).catch((error) => {
        errorReporter.captureException(error, { postLink: post.link, phase: 'pipeline' })
        console.error(`post ${post.link}: pipeline failed`, error)
      })
    })
  } catch (error) {
    errorReporter.captureException(error)
    resources?.dedupeStore.close()

    if (client !== undefined) {
      try {
        await client.destroy()
      } catch {
        // Preserve the startup error; the process is already failing.
      }
    }

    throw error
  }
}

export async function start(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let errorReporter: ErrorReporter | undefined
  try {
    if (argv[2] === 'login') {
      await runLogin(readLoginSettings(env))
    } else {
      const settings = readSettings(env)
      errorReporter = initializeSentry(settings.sentryDsn)
      await runDaemon(settings, createTelegramClient, undefined, errorReporter)
    }
  } catch (error) {
    if (argv[2] !== 'login') {
      (errorReporter ?? initializeSentry(env.SENTRY_DSN)).captureException(error)
    }
    console.error(errorMessage(error))
    process.exitCode = 1
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntrypoint) {
  void start()
}
