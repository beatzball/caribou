import { describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { createThreadStore } from '../thread-store.js'

const FOCUSED = { id: '300', content: 'focused', account: { id: '42' } } as unknown as mastodon.v1.Status
const ANC: mastodon.v1.Status[]  = [
  { id: '299', content: 'anc',  account: { id: '42' } } as unknown as mastodon.v1.Status,
]
const DESC: mastodon.v1.Status[] = [
  { id: '301', content: 'desc', account: { id: '42' } } as unknown as mastodon.v1.Status,
]

describe('createThreadStore', () => {
  it('starts ready when initial is provided', () => {
    const store = createThreadStore({} as unknown as CaribouClient, '300', {
      initial: { focused: FOCUSED, ancestors: ANC, descendants: DESC },
    })
    expect(store.focused.value.status).toBe('ready')
    expect(store.context.value.status).toBe('ready')
    if (store.focused.value.status === 'ready') {
      expect(store.focused.value.data.id).toBe('300')
    }
    if (store.context.value.status === 'ready') {
      expect(store.context.value.data.ancestors[0]?.id).toBe('299')
      expect(store.context.value.data.descendants[0]?.id).toBe('301')
    }
  })

  it('skips fetch when initial is provided', async () => {
    const fetchStatus = vi.fn(async () => FOCUSED)
    const fetchThread = vi.fn(async () => ({ ancestors: ANC, descendants: DESC }))
    const client = { fetchStatus, fetchThread } as unknown as CaribouClient
    const store = createThreadStore(client, '300', {
      initial: { focused: FOCUSED, ancestors: ANC, descendants: DESC },
    })
    await store.load()
    expect(fetchStatus).not.toHaveBeenCalled()
    expect(fetchThread).not.toHaveBeenCalled()
  })

  it('parallel-fetches focused + context on load() when initial is absent', async () => {
    const fetchStatus = vi.fn(async () => FOCUSED)
    const fetchThread = vi.fn(async () => ({ ancestors: ANC, descendants: DESC }))
    const client = { fetchStatus, fetchThread } as unknown as CaribouClient
    const store = createThreadStore(client, '300', {})
    await store.load()
    expect(fetchStatus).toHaveBeenCalledWith('300')
    expect(fetchThread).toHaveBeenCalledWith('300')
    if (store.focused.value.status !== 'ready') throw new Error('expected ready')
    expect(store.focused.value.data.id).toBe('300')
    if (store.context.value.status !== 'ready') throw new Error('expected ready')
    expect(store.context.value.data.descendants[0]?.id).toBe('301')
  })

  it('captures focused-fetch failure into the focused signal independently', async () => {
    const focusedErr = Object.assign(new Error('boom'), { code: 'not_found' })
    const fetchStatus = vi.fn(async () => { throw focusedErr })
    const fetchThread = vi.fn(async () => ({ ancestors: ANC, descendants: DESC }))
    const client = { fetchStatus, fetchThread } as unknown as CaribouClient
    const store = createThreadStore(client, '300', {})
    await store.load()
    expect(store.focused.value.status).toBe('error')
    expect(store.context.value.status).toBe('ready')
  })
})
