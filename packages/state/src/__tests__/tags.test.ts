import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { loadTag, tagCache, tagFollowing, tagKey, toggleTagFollow } from '../tags.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey

const tag = (name: string, following: boolean) =>
  ({ id: '1', name, url: `https://example.social/tags/${name}`, following }) as mastodon.v1.Tag

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeClient(over: Partial<CaribouClient> = {}): CaribouClient {
  return {
    userKey: ME,
    fetchTag: vi.fn(async (name: string) => tag(name, false)),
    followTag: vi.fn(async (name: string) => tag(name, true)),
    unfollowTag: vi.fn(async (name: string) => tag(name, false)),
    ...over,
  } as unknown as CaribouClient
}

let toasts: { kind: string; message: string }[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  tagCache.value = new Map()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  activeUserKey.value = null
})

describe('tagKey', () => {
  it('ignores case, so #AI and #ai are one tag', () => {
    expect(tagKey(ME, 'AI')).toBe(tagKey(ME, 'ai'))
  })

  it('folds composed and decomposed forms of a non-ASCII name together', () => {
    expect(tagKey(ME, 'Café')).toBe(tagKey(ME, 'café'))
  })
})

describe('loadTag', () => {
  it('caches whether the reader follows the tag', async () => {
    const client = fakeClient({ fetchTag: vi.fn(async (n: string) => tag(n, true)) })
    await loadTag('Caturday', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'caturday'))).toBe(true)
    expect(client.fetchTag).toHaveBeenCalledWith('Caturday')
  })

  it('treats a tag the server does not know as not followed', async () => {
    const client = fakeClient({ fetchTag: vi.fn(async () => { throw new Error('404') }) })
    await loadTag('nothing', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'nothing'))).toBe(false)
  })

  it('does nothing when nobody is signed in', async () => {
    await loadTag('ai', { clientSource: () => null })
    expect(tagCache.value.size).toBe(0)
  })

  it('does not overwrite a follow that started while it was loading', async () => {
    const read = deferred<mastodon.v1.Tag>()
    const client = fakeClient({ fetchTag: vi.fn(() => read.promise) })
    const loading = loadTag('ai', { clientSource: () => client })
    await toggleTagFollow('ai', { clientSource: () => client })
    read.resolve(tag('ai', false))
    await loading
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(true)
  })
})

describe('toggleTagFollow', () => {
  it('shows the follow at once, before the server answers', async () => {
    const write = deferred<mastodon.v1.Tag>()
    const client = fakeClient({ followTag: vi.fn(() => write.promise) })
    const done = toggleTagFollow('ai', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(true)
    write.resolve(tag('ai', true))
    await done
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(true)
  })

  it('unfollows a followed tag', async () => {
    tagCache.value = new Map([[tagKey(ME, 'ai'), true]])
    const client = fakeClient()
    await toggleTagFollow('ai', { clientSource: () => client })
    expect(client.unfollowTag).toHaveBeenCalledWith('ai')
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(false)
  })

  it('puts the old state back and says so when the write fails', async () => {
    const client = fakeClient({ followTag: vi.fn(async () => { throw new Error('500') }) })
    await toggleTagFollow('ai', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(false)
    expect(toasts).toEqual([{ kind: 'error', message: "Couldn't follow #ai." }])
  })

  it('says unfollow when an unfollow fails', async () => {
    tagCache.value = new Map([[tagKey(ME, 'ai'), true]])
    const client = fakeClient({ unfollowTag: vi.fn(async () => { throw new Error('500') }) })
    await toggleTagFollow('ai', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(true)
    expect(toasts[0]!.message).toBe("Couldn't unfollow #ai.")
  })

  it('drops a second click while the first is on its way', async () => {
    const write = deferred<mastodon.v1.Tag>()
    const client = fakeClient({ followTag: vi.fn(() => write.promise) })
    const first = toggleTagFollow('ai', { clientSource: () => client })
    await toggleTagFollow('AI', { clientSource: () => client })
    write.resolve(tag('ai', true))
    await first
    expect(client.followTag).toHaveBeenCalledTimes(1)
    expect(client.unfollowTag).not.toHaveBeenCalled()
  })
})

describe('tagFollowing', () => {
  it('reads the active account only', () => {
    tagCache.value = new Map([[tagKey(ME, 'ai'), true]])
    expect(tagFollowing('ai')).toBeUndefined()
    activeUserKey.value = ME
    expect(tagFollowing('AI')).toBe(true)
  })
})
