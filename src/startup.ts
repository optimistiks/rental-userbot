import type { Settings } from './config.js'
import { openDedupeStore, type DedupeStore } from './dedupe-store.js'
import { readCriteriaFile, readPromptFile } from './text-file.js'
import type { Telegram } from './telegram.js'
import { readZoneFile } from './zone.js'

export interface StartupResources {
  dedupeStore: DedupeStore
}

export function initializeStartup(
  settings: Settings,
  databasePath?: string,
): StartupResources {
  // Read-and-discard: the Evaluator re-reads both before every run, so this is
  // only the startup check that they exist and parse.
  readCriteriaFile(settings.criteriaPath)
  readPromptFile(settings.promptPath)
  readZoneFile(settings.zonePath)
  return { dedupeStore: openDedupeStore(databasePath) }
}

export function unjoinedChannelIds(
  channelIds: readonly number[],
  joinedChannelIds: readonly number[],
): number[] {
  const joined = new Set(joinedChannelIds)
  return channelIds.filter((channelId) => !joined.has(channelId))
}

export function startupMessage(
  channelIds: number[],
  joinedChannelIds: number[],
): string {
  const missing = unjoinedChannelIds(channelIds, joinedChannelIds)
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
  // Best-effort: the membership check is a warning, so a flood wait or a failed
  // dialog scan must not take the bot down with it.
  let joinedChannelIds: number[] | undefined
  try {
    joinedChannelIds = await telegram.joinedChannelIds()
  } catch (error) {
    console.warn('could not check channel membership', error)
  }

  const message =
    joinedChannelIds === undefined
      ? `🟢 started, watching ${channelIds.length} channels\nmembership not checked`
      : startupMessage(channelIds, joinedChannelIds)

  for (const channelId of unjoinedChannelIds(channelIds, joinedChannelIds ?? channelIds)) {
    console.warn(`channel not joined: ${channelId}`)
  }

  console.log(`startup: ${message.replace('\n', '; ')}`)
  await telegram.sendToMe(message)
}
