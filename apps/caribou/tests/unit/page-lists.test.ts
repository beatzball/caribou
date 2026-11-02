import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ListPageModule from '../../pages/lists/[id].js'
import type * as ListsPageModule from '../../pages/lists/index.js'
import type * as H3 from 'h3'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'

vi.mock('../../server/lib/resolve-instance.js', () => ({
  resolveInstanceForRoute: vi.fn(),
}))

vi.mock('../../server/lib/storage.js', () => ({
  getStorage: () => ({ getItem: async () => null }),
}))

let routeId = '3'
vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return { ...actual, getRouterParams: () => ({ id: routeId }) }
})

type Event = Parameters<typeof ListPageModule.pageData.fetcher>[0]

describe('/lists and /lists/[id] pageData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveInstanceForRoute).mockResolvedValue({ instance: 'example.social', source: 'cookie' })
  })

  it('/lists is the shell only: the lists need the token in the browser', async () => {
    const { pageData } = await import('../../pages/lists/index.js')
    expect(await pageData.fetcher({} as Event)).toEqual({
      kind: 'auth-required', shell: { instance: 'example.social', source: 'cookie' },
    })
  })

  it('/lists/[id] carries the id, and nothing of the list', async () => {
    routeId = '3'
    const { pageData } = await import('../../pages/lists/[id].js')
    expect(await pageData.fetcher({} as Event)).toEqual({
      kind: 'auth-required', shell: { instance: 'example.social', source: 'cookie' }, id: '3',
    })
  })

  it('/lists/[id] refuses a segment no list id can be', async () => {
    routeId = '..%2Fnotifications'
    const { pageData } = await import('../../pages/lists/[id].js')
    expect(await pageData.fetcher({} as Event)).toMatchObject({ kind: 'not-found', id: null })
  })
})

describe('<page-lists> and <page-lists-id> render', () => {
  beforeAll(async () => {
    await import('../../pages/lists/index.js')
    await import('../../pages/lists/[id].js')
  })
  beforeEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
  })
  afterEach(() => { document.body.replaceChildren() })

  const shell = { instance: 'example.social' }

  it('/lists: the placeholder signed out, the lists after mount signed in', async () => {
    const out = document.createElement('page-lists') as ListsPageModule.ListsPage
    out.serverData = { kind: 'auth-required', shell }
    document.body.appendChild(out)
    while (!(await out.updateComplete)) { /* until no update is pending */ }
    expect(out.shadowRoot!.querySelector('caribou-auth-required')!.getAttribute('label')).toContain('/lists shows your lists.')

    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    const el = document.createElement('page-lists') as ListsPageModule.ListsPage
    el.serverData = { kind: 'auth-required', shell }
    document.body.appendChild(el)
    // The first render equals the server's.
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('caribou-auth-required')).not.toBeNull()
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    expect(el.shadowRoot!.querySelector('caribou-lists')).not.toBeNull()
  })

  it('/lists/[id]: the placeholder first, then the header and the list timeline', async () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    const el = document.createElement('page-lists-id') as ListPageModule.ListPage
    el.serverData = { kind: 'auth-required', shell, id: '3' }
    document.body.appendChild(el)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('caribou-auth-required')).not.toBeNull()
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    expect(el.shadowRoot!.querySelector('caribou-list-header')!.getAttribute('list')).toBe('3')
    const tl = el.shadowRoot!.querySelector('caribou-timeline')!
    expect([tl.getAttribute('kind'), tl.getAttribute('list')]).toEqual(['list', '3'])
  })

  it('/lists/[id] for a bad address says so, signed in or not', async () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    const el = document.createElement('page-lists-id') as ListPageModule.ListPage
    el.serverData = { kind: 'not-found', shell, id: null }
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* until no update is pending */ }
    expect(el.shadowRoot!.querySelector('article')!.textContent).toBe('This is not a list address.')
    expect(el.shadowRoot!.querySelector('caribou-timeline')).toBeNull()
  })
})
