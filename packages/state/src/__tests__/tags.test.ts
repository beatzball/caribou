import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import { loadTag, normalizeTagName, tagCache, tagFollowing, tagKey, toggleTagFollow } from '../tags.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey
const OTHER = 'bob@example.social' as UserKey

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

// Mastodon's HashtagNormalizer: NFKC, lowercase, its ASCII folding table,
// then drop what is not a letter, digit or separator.
describe('normalizeTagName', () => {
  it('folds accented Latin letters to ASCII, as the server names the tag', () => {
    expect(normalizeTagName('Café')).toBe('cafe')
    expect(normalizeTagName('ŁÓDŹ')).toBe('lodz')
    expect(tagKey(ME, 'Café')).toBe(tagKey(ME, 'cafe'))
  })

  it('leaves letters outside the folding table alone', () => {
    expect(normalizeTagName('Straße')).toBe('straße')
    expect(normalizeTagName('Ærø')).toBe('æro')
    expect(normalizeTagName('日本')).toBe('日本')
  })

  it('makes full-width letters plain, and keeps separators', () => {
    expect(normalizeTagName('ＡＩ')).toBe('ai')
    expect(normalizeTagName('トム・ジェリー')).toBe('トム・ジェリー')
    expect(normalizeTagName('a_b')).toBe('a_b')
  })

  it('drops characters the server drops', () => {
    expect(normalizeTagName('हिन्दी')).toBe('हिनदी')
    expect(normalizeTagName('a-b')).toBe('ab')
  })
})

describe('loadTag', () => {
  it('caches whether the reader follows the tag', async () => {
    const client = fakeClient({ fetchTag: vi.fn(async (n: string) => tag(n, true)) })
    await loadTag('Caturday', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'caturday'))).toBe(true)
    expect(client.fetchTag).toHaveBeenCalledWith('Caturday')
  })

  it('treats a tag the server does not know (404) as not followed', async () => {
    const client = fakeClient({ fetchTag: vi.fn(async () => { throw new CaribouError('not_found', '404') }) })
    await loadTag('nothing', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'nothing'))).toBe(false)
  })

  it('keeps a known follow when the read fails for another reason', async () => {
    tagCache.value = new Map([[tagKey(ME, 'ai'), true]])
    const client = fakeClient({ fetchTag: vi.fn(async () => { throw new CaribouError('server_error', '503') }) })
    await loadTag('ai', { clientSource: () => client })
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(true)
  })

  it('leaves the state unknown when a first read fails', async () => {
    const client = fakeClient({ fetchTag: vi.fn(async () => { throw new CaribouError('rate_limited', '429') }) })
    await loadTag('ai', { clientSource: () => client })
    expect(tagCache.value.has(tagKey(ME, 'ai'))).toBe(false)
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

  it('does not overwrite a follow with a read that started while the follow was on its way', async () => {
    const write = deferred<mastodon.v1.Tag>()
    const read = deferred<mastodon.v1.Tag>()
    const client = fakeClient({ followTag: vi.fn(() => write.promise), fetchTag: vi.fn(() => read.promise) })
    const following = toggleTagFollow('ai', { clientSource: () => client })
    const loading = loadTag('ai', { clientSource: () => client })
    write.resolve(tag('ai', true))
    await following
    read.resolve(tag('ai', false))
    await loading
    expect(tagCache.value.get(tagKey(ME, 'ai'))).toBe(true)
  })

  it('drops a read that lands after the account changed', async () => {
    activeUserKey.value = ME
    const read = deferred<mastodon.v1.Tag>()
    const client = fakeClient({ fetchTag: vi.fn(() => read.promise) })
    const loading = loadTag('ai', { clientSource: () => client })
    activeUserKey.value = OTHER
    read.resolve(tag('ai', true))
    await loading
    expect(tagCache.value.size).toBe(0)
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

describe('toggleTagFollow across an account change', () => {
  // A followed tag, an unfollow held on its way, then the account switches.
  async function switchDuring(outcome: 'resolve' | 'reject', switches: UserKey[]): Promise<void> {
    activeUserKey.value = ME
    tagCache.value = new Map([[tagKey(ME, 'ai'), true]])
    const write = deferred<mastodon.v1.Tag>()
    const client = fakeClient({ unfollowTag: vi.fn(() => write.promise) })
    const done = toggleTagFollow('ai', { clientSource: () => client })
    for (const key of switches) activeUserKey.value = key
    if (outcome === 'resolve') write.resolve(tag('ai', false))
    else write.reject(new Error('500'))
    await done
  }

  for (const [name, switches] of [['A → B', [OTHER]], ['A → B → A', [OTHER, ME]]] as const) {
    it(`${name}: a failed unfollow neither rolls back nor tells anyone`, async () => {
      await switchDuring('reject', [...switches])
      expect(toasts).toEqual([])
      // Only the optimistic write, made while A was active, is there.
      expect([...tagCache.value.entries()]).toEqual([[tagKey(ME, 'ai'), false]])
    })

    it(`${name}: a late success writes nothing`, async () => {
      const writes: Map<string, boolean>[] = []
      const stop = tagCache.subscribe((v) => { writes.push(v) })
      await switchDuring('resolve', [...switches])
      stop()
      // The subscribe call, the seed and the optimistic write.
      expect(writes).toHaveLength(3)
    })
  }
})

describe('tagFollowing', () => {
  it('reads the active account only', () => {
    tagCache.value = new Map([[tagKey(ME, 'ai'), true]])
    expect(tagFollowing('ai')).toBeUndefined()
    activeUserKey.value = ME
    expect(tagFollowing('AI')).toBe(true)
  })
})
