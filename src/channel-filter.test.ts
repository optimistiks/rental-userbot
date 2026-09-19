import { describe, expect, it } from 'vitest'

import { isWatchedPost } from './channel-filter.js'

describe('isWatchedPost', () => {
  it('keeps Posts from configured channels', () => {
    expect(isWatchedPost({ chatId: -1001234567890 }, [-1001234567890])).toBe(true)
  })

  it('drops Posts from other chats', () => {
    expect(isWatchedPost({ chatId: -1001234567890 }, [-1009876543210])).toBe(false)
  })
})
