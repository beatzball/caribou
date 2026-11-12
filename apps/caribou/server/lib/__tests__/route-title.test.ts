// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { serverRouteTitle, withRouteTitle } from '../route-title.js'
import type { H3Event } from 'h3'
const url = (path: string) => new URL(path, 'https://example.test')

describe('rules 1 and 2: server titles share names and respect moderation', () => {
  it('names a visible profile and a thread without copying post text', () => {
    const account = { displayName: 'Alice', username: 'alice' }
    expect(serverRouteTitle(url('/@alice@example.social'), { kind: 'ok', account })).toBe('Alice · Caribou')
    expect(serverRouteTitle(url('/@alice/42'), { kind: 'ok', focused: { account, content: 'Private post text' } }))
      .toBe('Thread by Alice · Caribou')
  })
  it.each(['hidden', 'deferred', 'auth-required', 'error', 'not-found'])('%s uses the route name without identity', (kind) => {
    expect(serverRouteTitle(url('/@alice.example.com'), { kind, account: { displayName: 'Alice' } })).toBe('Profile · Caribou')
  })
  it('keeps missing and covered Bluesky identity out of the head', () => {
    const account = { displayName: 'Alice', bluesky: {} }
    expect(serverRouteTitle(url('/@alice.example.com'), { kind: 'ok', account })).toBe('Profile · Caribou')
    const covered = { ...account, bluesky: { moderation: { contexts: { profileView: { blur: true } } } } }
    expect(serverRouteTitle(url('/@alice.example.com'), { kind: 'ok', account: covered })).toBe('Profile · Caribou')
  })
  it('escapes a title exactly once at the HTML boundary', () => {
    expect(serverRouteTitle(url('/@alice'), { kind: 'ok', account: { displayName: '</title><script>"&' } }))
      .toBe('&lt;/title&gt;&lt;script&gt;&quot;&amp; · Caribou')
  })
  it('adds the head field with one data fetch and preserves hydration data', async () => {
    const data = { kind: 'ok', account: { displayName: 'Alice' }, statuses: [] }
    const fetcher = vi.fn(async () => data)
    const mod = withRouteTitle({ pageData: { __litroPageData: true, fetcher } }, url('/@alice'))
    const event = {} as H3Event
    const result = await (mod.pageData as { fetcher: (event: H3Event) => Promise<unknown> }).fetcher(event)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(event)
    expect(result).toEqual({ ...data, seoTitle: 'Alice · Caribou' })
  })
})
