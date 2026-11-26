import { afterEach, expect, it, vi } from 'vitest'
import { LitroRouter } from '@beatzball/litro-router'
import { startRouteTitles } from '../../components/_route-titles.js'
import { activeUserKey } from '@beatzball/caribou-state'

// #290's qualified route-name advisory shares #292's descriptive-title
// fix. Pin the installed router's fallback contract with actual nested and
// headingless pages with the real shared title lifecycle. Direct page
// headings take precedence over its document-title fallback.
// No second app announcer, dependency patch, or duplicate speech is needed.

afterEach(() => {
  document.body.replaceChildren()
  activeUserKey.value = null
  localStorage.clear()
  document.title = ''
  history.replaceState(null, '', '/')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses descriptive titles for nested/headingless pages once per transition and retains direct headings (README rule 3)', async () => {
  const listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = []
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options])
    add(type, listener, options)
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ kind: 'auth-required', tag: 'aurora', shell: { instance: null } })))
  // The page shells show their nested reading components after mount.
  // No user record/client exists, so no upstream request can escape.
  activeUserKey.value = 'alice@example.social'
  localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
  const outlet = document.createElement('div')
  document.body.append(outlet)
  history.replaceState(null, '', '/settings')
  const stopTitles = startRouteTitles(outlet)
  const router = new LitroRouter(outlet)
  const routes = [
    { path: '/settings', component: 'page-settings', action: async () => {
      await import('../../pages/settings.js')
    } },
    { path: '/notifications', component: 'page-notifications', action: async () => {
      await import('../../pages/notifications.js')
    } },
    { path: '/home', component: 'page-home', action: async () => {
      await import('../../pages/home.js')
    } },
    { path: '/tags/:tag', component: 'page-tags-tag', action: async () => {
      await import('../../pages/tags/[tag].js')
    } },
    { path: '/about', component: 'page-about', action: async () => {
      await import('../../pages/about.js')
    } },
  ]
  try {
    router.setRoutes(routes)
    const region = document.getElementById('_litro_announce')!
    expect(region.getAttribute('aria-live')).toBe('polite')
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'textContent')!
    // happy-dom implements textContent as paired accessors; retain the
    // getter explicitly while recording the router's writes.
    const writes = vi.fn((text: string | null) => descriptor.set!.call(region, text))
    Object.defineProperty(region, 'textContent', {
      configurable: true, get: () => descriptor.get!.call(region), set: writes,
    })
    const messages = () => writes.mock.calls.map(([text]) => text).filter(Boolean)
    await vi.waitFor(() => expect(region.textContent).toBe('Settings · Caribou'), { timeout: 5000 })
    await vi.waitFor(() => expect(messages()).toEqual(['Settings · Caribou']))
    expect(outlet.querySelector('page-settings')!.shadowRoot!.querySelector('caribou-settings')!.shadowRoot!.querySelector('h1')!.textContent).toBe('Settings')
    expect(document.activeElement).toBe(outlet)
    expect(document.title).toBe('Settings · Caribou')
    for (const [path, expected, title] of [
      ['/notifications', 'Notifications · Caribou', 'Notifications · Caribou'],
      ['/home', 'Home', 'Home · Caribou'],
      ['/about', 'About', 'About · Caribou'],
      ['/tags/aurora', '#aurora · Caribou', '#aurora · Caribou'],
    ]) {
      LitroRouter.go(path!)
      await vi.waitFor(() => expect(region.textContent).toBe(expected), { timeout: 5000 })
      await vi.waitFor(() => expect(messages().at(-1)).toBe(expected), { timeout: 5000 })
      expect(document.title).toBe(title)
      expect(document.activeElement).toBe(outlet)
      expect(document.querySelectorAll('#_litro_announce')).toHaveLength(1)
    }
    expect(messages()).toEqual(['Settings · Caribou', 'Notifications · Caribou', 'Home', 'About', '#aurora · Caribou'])
  } finally {
    stopTitles()
    for (const [type, listener, options] of listeners) window.removeEventListener(type, listener, options)
  }
})
