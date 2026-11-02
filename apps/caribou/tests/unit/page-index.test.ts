import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as H3 from 'h3'

const query = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, getQuery: () => query.value }
})

describe('/ pageData', () => {
  it('add is true for /?add (empty value) and /?add=1', async () => {
    const { pageData } = await import('../../pages/index.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    query.value = { add: '' }
    expect(await pageData.fetcher(event)).toEqual({ add: true })
    query.value = { add: '1' }
    expect(await pageData.fetcher(event)).toEqual({ add: true })
  })

  it('add is false without the parameter', async () => {
    const { pageData } = await import('../../pages/index.js')
    const event = {} as Parameters<typeof pageData.fetcher>[0]
    query.value = {}
    expect(await pageData.fetcher(event)).toEqual({ add: false })
    query.value = { error: 'denied' }
    expect(await pageData.fetcher(event)).toEqual({ add: false })
  })
})

// `/` goes to `/home` when an account is active (issue 135). A full load is
// decided by the head script; the page checks only a client-side navigation.
describe('/ onBeforeEnter', () => {
  const KEY = 'alice@example.social'
  const enter = async () => {
    const { IndexPage } = await import('../../pages/index.js')
    const { LitroPage } = await import('@beatzball/litro/runtime')
    const base = vi.spyOn(LitroPage.prototype, 'onBeforeEnter').mockResolvedValue()
    const replace = vi.spyOn(history, 'replaceState')
    const page = new IndexPage()
    await page.onBeforeEnter({ pathname: '/', params: {}, search: '', hash: '' })
    return { base, replace }
  }

  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    document.documentElement.removeAttribute('data-caribou-root')
    vi.restoreAllMocks()
  })

  it('a full load the head script kept on / stays, even after the banner consumed the error', async () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(KEY))
    localStorage.setItem('caribou.users', JSON.stringify([[KEY, {}]]))
    // The head script saw a stashed error and stayed; the banner has since
    // removed it from sessionStorage.
    document.documentElement.setAttribute('data-caribou-root', '')
    const { base, replace } = await enter()
    expect(replace).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
    // Decided once: a later client-side navigation to / checks again.
    expect(document.documentElement.hasAttribute('data-caribou-root')).toBe(false)
  })

  it('a client-side navigation to / with an active account replaces it with /home', async () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify(KEY))
    localStorage.setItem('caribou.users', JSON.stringify([[KEY, {}]]))
    const { base, replace } = await enter()
    expect(replace).toHaveBeenCalledWith(null, '', '/home')
    expect(base).not.toHaveBeenCalled()
  })

  it('a client-side navigation to / with no account stays', async () => {
    const { base, replace } = await enter()
    expect(replace).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
  })
})
