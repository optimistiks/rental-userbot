import { fileURLToPath } from 'node:url'

import { readSettings } from './config.js'
import { initializeStartup } from './startup.js'

export function start(): void {
  try {
    const settings = readSettings()
    const resources = initializeStartup(settings)
    resources.dedupeStore.close()
    console.log('startup checks passed')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntrypoint) {
  start()
}
