import type { Settings } from './config.js'
import { openDedupeStore, type DedupeStore } from './dedupe-store.js'
import { readCriteriaFile } from './criteria.js'

export interface StartupResources {
  settings: Settings
  criteria: string
  dedupeStore: DedupeStore
}

export function initializeStartup(
  settings: Settings,
  databasePath?: string,
): StartupResources {
  const criteria = readCriteriaFile(settings.criteriaPath)
  const dedupeStore = openDedupeStore(databasePath)
  return { settings, criteria, dedupeStore }
}
