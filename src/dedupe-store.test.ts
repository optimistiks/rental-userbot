import { describe, expect, it } from 'vitest'

import { openDedupeStore } from './dedupe-store.js'

describe('openDedupeStore', () => {
  it('creates the processed-posts store in the supplied SQLite database', () => {
    const store = openDedupeStore(':memory:')

    expect(store.isProcessed('chat:1')).toBe(false)
    store.markProcessed('chat:1')
    expect(store.isProcessed('chat:1')).toBe(true)

    store.close()
  })
})
