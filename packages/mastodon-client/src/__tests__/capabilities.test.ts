import { describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  createCaribouClient, MASTODON_CAPABILITIES, mastodonTimelineOrder,
} from '../create-client.js'

const userKey = toUserKey('beatzball', 'fosstodon.org')

function client() {
  return createCaribouClient(userKey, {
    get: () => ({ userKey, server: 'fosstodon.org', token: 'TOKEN-1' }),
    onUnauthorized: vi.fn(),
  })
}

describe('Mastodon capabilities', () => {
  it('says what Mastodon supports today', () => {
    expect(client().capabilities).toEqual({
      network: 'mastodon',
      localTimeline: true, publicTimeline: true,
      visibility: true, contentWarningText: true,
      polls: true, edit: true, customEmoji: true,
      followTags: true, privateLists: true, serverFilters: true,
      maxChars: 500, maxBytes: null, maxImages: 4, maxImageBytes: null,
    })
    expect(client().capabilities).toBe(MASTODON_CAPABILITIES)
  })
})

describe('Mastodon timeline order', () => {
  it('sorts a timeline newest first by id, longer ids first', () => {
    const order = client().timelineOrder('home')
    expect(order).not.toBeNull()
    expect(['9', '110', '12', '111'].sort(order!)).toEqual(['111', '110', '12', '9'])
  })

  it('keeps bookmarks in the order the server sent', () => {
    expect(client().timelineOrder('bookmarks')).toBeNull()
    expect(mastodonTimelineOrder('bookmarks')).toBeNull()
  })

  it('sorts hashtag and list timelines by id too', () => {
    expect(mastodonTimelineOrder({ type: 'hashtag', tag: 'x' })).not.toBeNull()
    expect(mastodonTimelineOrder({ type: 'list', id: '1' })).not.toBeNull()
  })
})
