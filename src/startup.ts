import type { Settings } from './config.js'
import { openDedupeStore, type DedupeStore } from './dedupe-store.js'
import { readCriteriaFile } from './criteria.js'
import type { Telegram } from './telegram.js'

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

export function startupMessage(
  channelIds: number[],
  joinedChannelIds: number[],
): string {
  const joined = new Set(joinedChannelIds)
  const missing = channelIds.filter((channelId) => !joined.has(channelId))
  const lines = [`🟢 started, watching ${channelIds.length - missing.length}/${channelIds.length} channels`]

  if (missing.length > 0) {
    lines.push(`not joined: ${missing.join(', ')}`)
  }

  return lines.join('\n')
}

export async function announceStartup(
  telegram: Pick<Telegram, 'joinedChannelIds' | 'sendToMe'>,
  channelIds: number[],
): Promise<void> {
  const joinedChannelIds = await telegram.joinedChannelIds()
  const message = startupMessage(channelIds, joinedChannelIds)
  const missing = channelIds.filter((channelId) => !joinedChannelIds.includes(channelId))

  for (const channelId of missing) {
    console.warn(`channel not joined: ${channelId}`)
  }

  console.log(`startup: ${message.replace('\n', '; ')}`)
  await telegram.sendToMe(message)
}
