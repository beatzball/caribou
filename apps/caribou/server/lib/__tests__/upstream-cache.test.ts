import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as UpstreamCache from '../upstream-cache.js'

describe('cachedFetch', () => {
  let cachedFetch: typeof UpstreamCache.cachedFetch
  let TTL: typeof UpstreamCache.TTL

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../upstream-cache.js')
    cachedFetch = mod.cachedFetch
    TTL = mod.TTL
  })

  it('returns parsed JSON on 200', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const v = await cachedFetch<{ ok: number }>('https://e.com/a', TTL.STATUS)
    expect(v.ok).toBe(1)
    fetchSpy.mockRestore()
  })

  it('serves cached value within TTL without re-fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"v":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    await cachedFetch('https://e.com/b', TTL.STATUS)
    await cachedFetch('https://e.com/b', TTL.STATUS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })

  it('throws on non-200 and does not cache the error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response('{"v":2}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(cachedFetch('https://e.com/c', TTL.STATUS)).rejects.toThrow(/upstream 500/)
    const v = await cachedFetch<{ v: number }>('https://e.com/c', TTL.STATUS)
    expect(v.v).toBe(2)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    fetchSpy.mockRestore()
  })

  it('dedups concurrent in-flight requests for the same URL', async () => {
    let resolveFetch!: (r: Response) => void
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((res) => { resolveFetch = res }),
    )
    const p1 = cachedFetch('https://e.com/d', TTL.STATUS)
    const p2 = cachedFetch('https://e.com/d', TTL.STATUS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    resolveFetch(new Response('{"v":3}', { status: 200, headers: { 'content-type': 'application/json' } }))
    expect((await p1 as { v: number }).v).toBe(3)
    expect((await p2 as { v: number }).v).toBe(3)
    fetchSpy.mockRestore()
  })

  it('shares rejection across concurrent joiners', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    )
    const p1 = cachedFetch('https://e.com/e', TTL.STATUS).catch((e) => (e as Error).message)
    const p2 = cachedFetch('https://e.com/e', TTL.STATUS).catch((e) => (e as Error).message)
    expect(await p1).toMatch(/upstream 500/)
    expect(await p2).toMatch(/upstream 500/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })

  it('does not cache a 429, and keeps its status and Retry-After', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(new Response('{"v":4}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const err = await cachedFetch('https://e.com/f', TTL.BLUESKY_PROFILE).catch((e: unknown) => e)
    const { UpstreamError } = await import('../upstream-cache.js')
    expect(err).toBeInstanceOf(UpstreamError)
    expect(err).toMatchObject({ status: 429, retryAfter: '7', message: 'upstream 429 https://e.com/f' })
    expect((await cachedFetch<{ v: number }>('https://e.com/f', TTL.BLUESKY_PROFILE)).v).toBe(4)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    fetchSpy.mockRestore()
  })

  it('names a 30 s TTL for each Bluesky page call, and a longer one for label definitions', () => {
    expect(TTL.BLUESKY_PROFILE).toBe(30_000)
    expect(TTL.BLUESKY_AUTHOR_FEED).toBe(30_000)
    expect(TTL.BLUESKY_THREAD).toBe(30_000)
    expect(TTL.BLUESKY_LABEL_DEFS).toBeGreaterThan(30_000)
  })

  describe('a refusal (401 or 403) is kept for REFUSAL_TTL_MS', () => {
    const answer = (status: number) => new Response('{}', { status, headers: { 'content-type': 'application/json' } })

    it.each([401, 403])('a %i is not asked again inside the window, and is asked again after it', async (status) => {
      const mod = await import('../upstream-cache.js')
      let now = 1_000_000
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer(status))
      const url = `https://refuses.example/r${status}`
      await expect(cachedFetch(url, TTL.PROFILE)).rejects.toMatchObject({ status })
      now += mod.REFUSAL_TTL_MS - 1
      await expect(cachedFetch(url, TTL.PROFILE)).rejects.toMatchObject({ status })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      now += 2
      await expect(cachedFetch(url, TTL.PROFILE)).rejects.toMatchObject({ status })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      // Another path on the same host is its own entry.
      await expect(cachedFetch('https://refuses.example/other', TTL.PROFILE)).rejects.toMatchObject({ status })
      expect(fetchSpy).toHaveBeenCalledTimes(3)
      expect(mod.REFUSAL_TTL_MS).toBe(60_000)
      fetchSpy.mockRestore()
      clock.mockRestore()
    })

    it.each([404, 429, 500])('a %i is asked again at once', async (status) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer(status))
      const url = `https://e.com/again${status}`
      await expect(cachedFetch(url, TTL.PROFILE)).rejects.toMatchObject({ status })
      await expect(cachedFetch(url, TTL.PROFILE)).rejects.toMatchObject({ status })
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      fetchSpy.mockRestore()
    })
  })
})
