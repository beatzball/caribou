// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'
import { TTL } from '../../server/lib/upstream-cache.js'
import type * as UpstreamCache from '../../server/lib/upstream-cache.js'

// #187: per-call TTLs, and the back-off after a 429 (README, "Bluesky SSR:
// rate limits"). The cache is the real one; each test uses its own AppView
// origin so cached answers never cross tests.

const ttls: Array<{ method: string; ttl: number }> = []
vi.mock('../../server/lib/upstream-cache.js', async (importOriginal) => {
  const real = await importOriginal<typeof UpstreamCache>()
  return {
    ...real,
    cachedFetch: (url: string, ttl: number, init?: Pick<RequestInit, 'redirect'>) => {
      ttls.push({ method: new URL(url).pathname.replace('/xrpc/', ''), ttl })
      return real.cachedFetch(url, ttl, init)
    },
  }
})

const bsky = await import('../../server/lib/bluesky-public.js')

let seq = 0
let calls: string[] = []
let answer429: { method: string; retryAfter?: string } | null = null
let answer500: string | null = null

beforeEach(() => {
  process.env.BLUESKY_PUBLIC_APPVIEW = `http://backoff-${++seq}.test`
  calls = []
  ttls.length = 0
  answer429 = null
  answer500 = null
  bsky._testOnlyResetBackoff()
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    calls.push(input)
    const url = new URL(input)
    const method = url.pathname.replace('/xrpc/', '')
    if (answer429?.method === method) {
      return new Response('{}', { status: 429, headers: answer429.retryAfter === undefined ? {} : { 'retry-after': answer429.retryAfter } })
    }
    if (answer500 === method) return new Response('{}', { status: 500 })
    const { status, body } = fx.appviewAnswer(method, url.searchParams)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.BLUESKY_PUBLIC_APPVIEW
})

describe('retryAfterSeconds', () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  it.each([
    ['whole seconds', '12', 12],
    ['missing', null, 30],
    ['empty', '', 30],
    ['not a number or a date', 'soon', 30],
    ['negative', '-5', 30],
    ['huge', '86400', 60],
    ['zero', '0', 1],
    ['an HTTP date 20 s ahead', new Date(now + 20_000).toUTCString(), 20],
    ['an HTTP date in the past', new Date(now - 60_000).toUTCString(), 1],
    ['an HTTP date far ahead', new Date(now + 3_600_000).toUTCString(), 60],
  ])('%s → %s s', (_name, header, seconds) => {
    expect(bsky.retryAfterSeconds(header, now)).toBe(seconds)
  })
})

describe('TTL per call', () => {
  it('uses the named Bluesky TTLs: 30 s for profile, author feed and thread; the long one for label definitions', async () => {
    await bsky.fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })
    await bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')
    const byMethod = Object.fromEntries(ttls.map((t) => [t.method, t.ttl]))
    expect(byMethod).toEqual({
      'app.bsky.actor.getProfile': TTL.BLUESKY_PROFILE,
      'app.bsky.feed.getAuthorFeed': TTL.BLUESKY_AUTHOR_FEED,
      'app.bsky.feed.getPostThread': TTL.BLUESKY_THREAD,
      'app.bsky.labeler.getServices': TTL.BLUESKY_LABEL_DEFS,
    })
  })
})

describe('the back-off after a 429', () => {
  it('a 429 is a rate limit, and no AppView fetch goes out until Retry-After has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-08T12:00:00Z') })
    answer429 = { method: 'app.bsky.actor.getProfile', retryAfter: '10' }
    const first = await bsky.fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' }).catch((e: unknown) => e)
    expect(bsky.isRateLimited(first)).toBe(true)
    answer429 = null
    const before = calls.length
    // Inside the back-off: a profile and a thread both defer, with no fetch.
    vi.setSystemTime(Date.parse('2026-11-08T12:00:09Z'))
    await expect(bsky.fetchBlueskyProfilePage('bob.example.com', { tab: 'posts' })).rejects.toSatisfy(bsky.isRateLimited)
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).rejects.toSatisfy(bsky.isRateLimited)
    expect(calls.length).toBe(before)
    // After it: fetches again.
    vi.setSystemTime(Date.parse('2026-11-08T12:00:11Z'))
    const page = await bsky.fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })
    expect(page.kind).toBe('ok')
    expect(calls.length).toBeGreaterThan(before)
  })

  it('a missing Retry-After backs off for the default, and a huge one for the cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-08T12:00:00Z') })
    answer429 = { method: 'app.bsky.feed.getPostThread' }
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).rejects.toSatisfy(bsky.isRateLimited)
    answer429 = null
    vi.setSystemTime(Date.parse('2026-11-08T12:00:29Z'))
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).rejects.toSatisfy(bsky.isRateLimited)
    vi.setSystemTime(Date.parse('2026-11-08T12:00:31Z'))
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).resolves.toBeTruthy()

    answer429 = { method: 'app.bsky.feed.getPostThread', retryAfter: '99999' }
    process.env.BLUESKY_PUBLIC_APPVIEW = `http://backoff-${++seq}.test`
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).rejects.toSatisfy(bsky.isRateLimited)
    answer429 = null
    vi.setSystemTime(Date.parse('2026-11-08T12:01:30Z'))
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).rejects.toSatisfy(bsky.isRateLimited)
    vi.setSystemTime(Date.parse('2026-11-08T12:01:32Z'))
    await expect(bsky.fetchBlueskyThread('alice.example.com', '3kalicefocus')).resolves.toBeTruthy()
  })

  it('a 5xx is an error as before: no back-off', async () => {
    answer500 = 'app.bsky.actor.getProfile'
    const err = await bsky.fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' }).catch((e: unknown) => e)
    expect(bsky.isRateLimited(err)).toBe(false)
    expect(String(err)).toContain('upstream 500')
    answer500 = null
    expect((await bsky.fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })).kind).toBe('ok')
  })
})
