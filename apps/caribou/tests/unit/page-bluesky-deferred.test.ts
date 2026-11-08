import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import { activeUserKey, clearKeptAlive, statusCache, users } from '@beatzball/caribou-state'
import * as fx from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'

// #187: a page the server deferred (the AppView rate limited it) is read by
// the browser, through the same guard as the server. Signed out, a hidden
// author is the notice and none of its strings reach the DOM or the data.

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/instance-cookie.js', () => ({ getInstance: vi.fn() }))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, getRequestURL: () => new URL('http://localhost:3000/') }
})

const APPVIEW = 'http://appview.test'
const SHELL = { instance: null }
const NOTICE = 'This account asked to be seen only by signed-in readers.'
let calls: string[] = []

// Everything a page shows: every shadow root's markup, attributes included.
function deepHtml(root: Element | ShadowRoot): string {
  let out = root instanceof Element ? root.outerHTML : root.innerHTML
  if (root instanceof Element && root.shadowRoot) out += deepHtml(root.shadowRoot)
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out += deepHtml(el.shadowRoot)
  return out
}

async function settle(el: HTMLElement & { updateComplete: Promise<boolean> }, until: () => boolean) {
  for (let i = 0; i < 200 && !until(); i++) {
    await new Promise((r) => setTimeout(r, 5))
    while (!(await el.updateComplete)) { /* settle */ }
  }
}

async function mount(tag: string, serverData: unknown, path: string) {
  history.replaceState(null, '', path)
  const el = document.createElement(tag) as HTMLElement & { serverData: unknown; updateComplete: Promise<boolean> }
  el.serverData = serverData
  let first = ''
  ;(el as unknown as { addController(c: object): void }).addController({
    hostUpdated: () => { first ||= el.shadowRoot?.querySelector('caribou-app-shell')?.innerHTML ?? '' },
  })
  document.body.appendChild(el)
  return { el, first: () => first }
}

beforeAll(async () => {
  await import('../../pages/@[handle].js')
  await import('../../pages/@[handle]/[statusId].js')
})
beforeEach(() => {
  document.body.replaceChildren()
  clearKeptAlive()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  calls = []
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    calls.push(input)
    if (!input.startsWith(`${APPVIEW}/xrpc/`) || init?.redirect !== 'error') throw new Error(`unexpected fetch ${input}`)
    const url = new URL(input)
    const { status, body } = fx.appviewAnswer(url.pathname.replace('/xrpc/', ''), url.searchParams)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const deferredProfile = { kind: 'deferred', appview: APPVIEW, shell: SHELL, handle: '' }
const deferredThread = { kind: 'deferred', appview: APPVIEW, shell: SHELL, handle: '', statusId: '' }

describe('a deferred profile, signed out', () => {
  it('first renders the loading shell, then the profile from the AppView', async () => {
    const { el, first } = await mount('page-handle', deferredProfile, '/@alice.example.com')
    await settle(el, () => deepHtml(el).includes('alice plain post'))
    expect(first()).toContain('Loading…')
    expect(deepHtml(el)).toContain('Alice Visible')
    expect(calls.every((u) => u.startsWith(`${APPVIEW}/xrpc/`))).toBe(true)
  })

  it('a hidden author in the feed is the notice, and none of the hidden strings are in the DOM or the data', async () => {
    const { el } = await mount('page-handle', deferredProfile, '/@alice.example.com')
    await settle(el, () => deepHtml(el).includes('alice plain post'))
    const shown = deepHtml(el)
    const data = JSON.stringify((el as unknown as { fallback: unknown }).fallback)
    expect(shown).toContain(NOTICE)
    for (const s of [...fx.HANA_SECRETS, ...fx.NORA_SECRETS, ...fx.PARTIAL_SECRETS]) {
      expect(shown, s).not.toContain(s)
      expect(data, s).not.toContain(s)
    }
  })

  it('a hidden profile is the notice, and its posts are never fetched', async () => {
    const { el } = await mount('page-handle', deferredProfile, '/@hana.example.com')
    await settle(el, () => deepHtml(el).includes(NOTICE))
    expect(deepHtml(el)).toContain(NOTICE)
    for (const s of fx.HANA_SECRETS) expect(deepHtml(el), s).not.toContain(s)
    expect(calls.some((u) => u.includes('getAuthorFeed'))).toBe(false)
  })

  it('a profile opened by DID shows the handle form after the browser read it', async () => {
    const { el } = await mount('page-handle', deferredProfile, '/@did:plc:alice')
    await settle(el, () => location.pathname === '/@alice.example.com')
    expect(location.pathname).toBe('/@alice.example.com')
  })
})

describe('a deferred thread, signed out', () => {
  it('hidden posts are notices; the rest renders; nothing hidden is in the DOM or the data', async () => {
    const { el, first } = await mount('page-handle-statusid', deferredThread, '/@alice.example.com/3kalicefocus')
    await settle(el, () => deepHtml(el).includes('alice thread focus'))
    expect(first()).toContain('Loading…')
    const shown = deepHtml(el)
    expect(shown).toContain('bob parent post')
    expect(shown).toContain(NOTICE)
    const data = JSON.stringify((el as unknown as { fallback: unknown }).fallback)
    for (const s of [...fx.HANA_SECRETS, ...fx.PARTIAL_SECRETS]) {
      expect(shown, s).not.toContain(s)
      expect(data, s).not.toContain(s)
    }
  })

  it('a thread focused on a hidden author keeps no handle', async () => {
    const { el } = await mount('page-handle-statusid', deferredThread, '/@hana.example.com/3khanafocus')
    await settle(el, () => deepHtml(el).includes('carol reply to hana'))
    expect((el as unknown as { fallback: { handle: string } }).fallback.handle).toBe('')
    for (const s of fx.HANA_SECRETS) expect(deepHtml(el), s).not.toContain(s)
  })
})
