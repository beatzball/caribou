import { describe, expect, it } from 'vitest'
import type { Status } from '@beatzball/caribou-mastodon-client'
import { oneSlicePerThread, threadKey } from '../_bluesky-slices.js'

// README, "Bluesky views", "Home shows threads as slices", rule 4.

const bsky = (id: string, root?: string) => ({
  id, reblog: null,
  bluesky: { uri: id, replyRef: root ? { root: { uri: root, cid: 'c' }, parent: { uri: root, cid: 'c' } } : null },
}) as unknown as Status
const mastodon = (id: string) => ({ id, reblog: null }) as unknown as Status

describe('one slice per thread', () => {
  it('a reply is its root\'s thread; a plain post is its own', () => {
    expect(threadKey(bsky('r1', 'p0'))).toBe(threadKey(bsky('p0')))
    expect(threadKey(bsky('p1'))).not.toBe(threadKey(bsky('p0')))
  })

  it('a repost and a Mastodon post never share a thread', () => {
    const repost = { ...bsky('rp1'), reblog: bsky('p0') } as Status
    expect(threadKey(repost)).not.toBe(threadKey(bsky('p0')))
    expect(threadKey(mastodon('p0'))).not.toBe(threadKey(bsky('p0')))
  })

  it('keeps the first (newest) entry of each thread', () => {
    const list = [bsky('r2', 'p0'), bsky('x'), bsky('r1', 'p0'), bsky('p0'), bsky('y')]
    expect(oneSlicePerThread(list).map((s) => s.id)).toEqual(['r2', 'x', 'y'])
  })

  it('answers the same array when nothing is dropped', () => {
    const list = [bsky('a'), bsky('b', 'z'), mastodon('c'), mastodon('c2')]
    expect(oneSlicePerThread(list)).toBe(list)
  })
})
