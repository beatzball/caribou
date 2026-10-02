import { afterEach, beforeAll, describe, it, expect, beforeEach, vi } from 'vitest'
import type * as H3 from 'h3'
import type * as HomePageModule from '../../pages/home.js'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))

vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, getRequestURL: () => new URL('http://localhost:3000/home') }
})

describe('/home pageData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth-required with shell instance from cookie', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({
      instance: 'example.social',
      source: 'cookie',
    })
    const { pageData } = await import('../../pages/home.js')
    const result = await pageData.fetcher({} as Parameters<typeof pageData.fetcher>[0])
    expect(result).toEqual({
      kind: 'auth-required',
      shell: { instance: 'example.social' },
    })
  })

  it('returns auth-required with null instance when cookie absent', async () => {
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: null })
    const { pageData } = await import('../../pages/home.js')
    const result = await pageData.fetcher({} as Parameters<typeof pageData.fetcher>[0])
    expect(result.kind).toBe('auth-required')
    expect(result.shell.instance).toBeNull()
  })
})

describe('<page-home> render', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
  })
  afterEach(() => { document.body.replaceChildren() })

  beforeAll(async () => { await import('../../pages/home.js') })

  // Synchronous on purpose: an await between the append and the first
  // `updateComplete` would let the first render pass unseen.
  function create() {
    const el = document.createElement('page-home') as HomePageModule.HomePage
    el.serverData = { kind: 'auth-required', shell: { instance: 'example.social' } }
    document.body.appendChild(el)
    return el
  }
  const placeholder = (el: Element) => el.shadowRoot!.querySelector('caribou-auth-required')
  const timeline = (el: Element) => el.shadowRoot!.querySelector('caribou-timeline')

  it('shows the auth-required placeholder when no user is signed in', async () => {
    const el = create()
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    expect(placeholder(el)!.getAttribute('label')).toBe(
      '/home shows your personal timeline. It requires a Mastodon access token, which Caribou keeps on your device.',
    )
    expect(timeline(el)).toBeNull()
    expect(el.shadowRoot!.querySelector('caribou-app-shell')!.getAttribute('instance')).toBe('example.social')
  })

  it.each(['null', '""'])('treats a stored active user key of %s as signed out', async (stored) => {
    localStorage.setItem('caribou.activeUserKey', stored)
    const el = create()
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    expect(placeholder(el)).not.toBeNull()
    expect(timeline(el)).toBeNull()
  })

  it('renders the placeholder first, then swaps in the home timeline for a signed-in user', async () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    const el = create()

    // First render equals the server render, so hydration has nothing to fix.
    await el.updateComplete
    expect(placeholder(el)).not.toBeNull()
    expect(timeline(el)).toBeNull()

    while (!(await el.updateComplete)) { /* until no update is pending */ }
    expect(placeholder(el)).toBeNull()
    expect(timeline(el)!.getAttribute('kind')).toBe('home')
    // The timeline sits in the shell's slot, as the placeholder did.
    expect(timeline(el)!.parentElement).toBe(el.shadowRoot!.querySelector('caribou-app-shell'))
  })
})
