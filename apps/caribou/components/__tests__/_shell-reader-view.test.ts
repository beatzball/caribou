import { describe, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals-core'
import type * as StateModule from '@beatzball/caribou-state'
import type { Status } from '@beatzball/caribou-mastodon-client'

// `loadReaderViewFrom` asks the reader's Mastodon server for its copy of
// server-rendered posts. A Bluesky post is never sent there (README,
// "Bluesky SSR"): its id means nothing to a Mastodon server.

const loadReaderView = vi.fn(async () => {})
vi.mock('@beatzball/caribou-state', async (importOriginal) => {
  const real = await importOriginal<typeof StateModule>()
  return {
    ...real,
    activeClient: signal({ userKey: 'bob@example.social', capabilities: { network: 'mastodon' } }),
    activeUser: signal({ server: 'example.social' }),
    loadReaderView,
  }
})

const masto = { id: '1', uri: 'https://example.social/1' } as Status
const bsky = { id: 'at://did:plc:alice/app.bsky.feed.post/3k', uri: 'at://did:plc:alice/app.bsky.feed.post/3k', bluesky: {} } as Status
const repostOfBsky = { id: 'at://did:plc:alice/app.bsky.feed.repost/3r', uri: 'x', reblog: bsky, bluesky: {} } as Status

describe('loadReaderViewFrom', () => {
  it('sends only the Mastodon posts to the reader\'s server', async () => {
    const { loadReaderViewFrom } = await import('../_shell.js')
    loadReaderViewFrom('example.social', [masto, bsky, repostOfBsky])
    expect(loadReaderView).toHaveBeenCalledWith([masto], expect.anything())
  })

  it('asks nothing for a page of Bluesky posts', async () => {
    loadReaderView.mockClear()
    const { loadReaderViewFrom } = await import('../_shell.js')
    loadReaderViewFrom('example.social', [bsky, repostOfBsky])
    expect(loadReaderView).not.toHaveBeenCalled()
  })
})
