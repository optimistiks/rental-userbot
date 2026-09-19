import { fileURLToPath } from 'node:url'

import { readLoginSettings, readSettings, type LoginSettings, type Settings } from './config.js'
import {
  createTelegramAdapter,
  createTelegramClient,
  startDaemonSession,
  type SessionClient,
  type TelegramClientLike,
} from './telegram.js'
import { createEvaluator } from './evaluator.js'
import { createPostPipeline } from './pipeline.js'
import { announceStartup, initializeStartup } from './startup.js'

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
): Promise<void> {
  const resources = initializeStartup(settings, databasePath)
  let client: ManagedClient | undefined

  try {
    client = makeClient(settings)
    await startDaemonSession(client)
    const telegram = createTelegramAdapter(client)
    await announceStartup(telegram, settings.channelIds)
    const pipeline = createPostPipeline({
      channelIds: settings.channelIds,
      evaluator: createEvaluator(settings),
      telegram,
    })
    telegram.onPost((post) => {
      void pipeline.process(post).catch((error) => {
        console.error(`post ${post.link}: pipeline failed`, error)
      })
    })
  } catch (error) {
    resources.dedupeStore.close()

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
  try {
    if (argv[2] === 'login') {
      await runLogin(readLoginSettings(env))
    } else {
      await runDaemon(readSettings(env))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntrypoint) {
  void start()
}
