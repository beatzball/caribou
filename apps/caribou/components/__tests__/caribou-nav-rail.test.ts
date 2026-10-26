import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, users } from '@beatzball/caribou-state'
import { toUserKey } from '@beatzball/caribou-auth'
import { LitroRouter } from '@beatzball/litro-router'
import '../caribou-nav-rail.js'
import { CaribouNavRail } from '../caribou-nav-rail.js'
import type { CaribouButton } from '../caribou-button.js'

// Spy on the real router: the click handler reaches it through a dynamic
// import, and both import forms must observe the same callable.
const goSpy = vi.spyOn(LitroRouter, 'go').mockImplementation(async () => {})

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM

async function mount(current = ''): Promise<CaribouNavRail> {
  const el = document.createElement('caribou-nav-rail') as CaribouNavRail
  if (current) el.setAttribute('current', current)
  document.body.appendChild(el)
  // Reading the location after the first update schedules a second one;
  // `updateComplete` resolves false until no update is pending.
  while (!(await el.updateComplete)) { /* wait for the follow-up update */ }
  return el
}

// Let the handler's `import(...).then(...)` chain run to completion.
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('caribou-nav-rail', () => {
  beforeEach(() => {
    users.value = new Map()
    activeUserKey.value = null
    goSpy.mockClear()
    happyDOM.setURL('http://localhost/')
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders the real nav anchors inside a labelled <nav>', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary')
    const hrefs = [...el.shadowRoot!.querySelectorAll('nav > a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/home', '/local', '/public', '/bookmarks', '/@me'])
    const labels = [...el.shadowRoot!.querySelectorAll('nav > a .label')].map((s) => s.textContent)
    expect(labels).toEqual(['Home', 'Local', 'Public', 'Bookmarks', 'Profile'])
    const icons = [...el.shadowRoot!.querySelectorAll('nav > a caribou-icon')].map((i) => i.getAttribute('name'))
    expect(icons).toEqual(['home', 'users', 'globe', 'bookmark', 'user'])
  })

  it('marks the route in `current` with aria-current="page"', async () => {
    const el = await mount('/local')
    const active = el.shadowRoot!.querySelectorAll('a[aria-current="page"]')
    expect(active.length).toBe(1)
    expect(active[0]!.getAttribute('href')).toBe('/local')
  })

  it('treats /@me/* as active for the Profile anchor', async () => {
    const el = await mount('/@me/posts')
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toBe('/@me')
  })

  it('marks the item for the current location after the first update', async () => {
    happyDOM.setURL('http://localhost/public')
    const el = await mount()
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toBe('/public')
  })

  it('renders no active item in the first render, as the server does', async () => {
    happyDOM.setURL('http://localhost/public')
    let activeAtFirstRender: Element | null | undefined
    const proto = CaribouNavRail.prototype as unknown as { firstUpdated(): void }
    const original = proto.firstUpdated
    const spy = vi.spyOn(proto, 'firstUpdated').mockImplementation(function (this: CaribouNavRail) {
      activeAtFirstRender = this.shadowRoot!.querySelector('a[aria-current]')
      original.call(this)
    })
    try {
      await mount()
    } finally {
      spy.mockRestore()
    }
    expect(activeAtFirstRender).toBeNull()
  })

  it('marks nothing on a route that is not a nav item', async () => {
    happyDOM.setURL('http://localhost/about')
    const el = await mount()
    expect(el.shadowRoot!.querySelector('a[aria-current]')).toBeNull()
  })

  it('routes a plain click on a nav anchor through LitroRouter', async () => {
    const el = await mount()
    const a = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="/home"]')!
    const click = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 })
    a.dispatchEvent(click)
    await flush()
    expect(click.defaultPrevented).toBe(true)
    expect(goSpy).toHaveBeenCalledWith('/home')
  })

  it('marks the item being navigated to as pending, and leaves aria-current on the shown page', async () => {
    happyDOM.setURL('http://localhost/public')
    const el = await mount()
    // What LitroRouter.go does: push the URL, then fire popstate.
    happyDOM.setURL('http://localhost/local')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('a[data-pending]')?.getAttribute('href')).toBe('/local')
    expect(el.shadowRoot!.querySelector('a[aria-busy="true"]')?.getAttribute('href')).toBe('/local')
    expect(el.shadowRoot!.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/public')

    // Back to the shown page: nothing is pending any more.
    happyDOM.setURL('http://localhost/public')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('a[data-pending]')).toBeNull()
  })

  it('clears the pending mark when a page chunk fails to load', async () => {
    happyDOM.setURL('http://localhost/public')
    const el = await mount()
    happyDOM.setURL('http://localhost/@me/posts')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('a[data-pending]')?.getAttribute('href')).toBe('/@me')

    // The router rejects when the route's dynamic import fails.
    window.dispatchEvent(new Event('unhandledrejection'))
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('a[data-pending]')).toBeNull()
  })

  it('leaves modified and non-primary clicks to the browser', async () => {
    const el = await mount()
    const a = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="/home"]')!
    // Stop the browser default at the document so happy-dom does not navigate.
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('click', stop)
    try {
      for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, ...init }))
        await flush()
        expect(goSpy, `should not route with ${JSON.stringify(init)}`).not.toHaveBeenCalled()
      }
    } finally {
      document.removeEventListener('click', stop)
    }
  })

  it('sets [signed-out] on the host from the activeUserKey signal', async () => {
    const el = await mount()
    expect(el.hasAttribute('signed-out')).toBe(true)

    activeUserKey.value = toUserKey('alice', 'example.social')
    expect(el.hasAttribute('signed-out')).toBe(false)

    activeUserKey.value = null
    expect(el.hasAttribute('signed-out')).toBe(true)
  })

  it('stops following the signal once disconnected', async () => {
    const el = await mount()
    el.remove()
    activeUserKey.value = toUserKey('alice', 'example.social')
    expect(el.hasAttribute('signed-out')).toBe(true)
  })

  it('renders sign-out as a POST form to /api/signout, not a link', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('a[href="/api/signout"]')).toBeFalsy()
    expect(el.shadowRoot!.querySelector('litro-link[href="/api/signout"]')).toBeFalsy()
    const form = el.shadowRoot!.querySelector('caribou-signout-form form[action="/api/signout"]')
    expect(form).toBeTruthy()
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
    const btn = form?.querySelector('button[type="submit"]')
    expect(btn).toBeTruthy()
    expect(btn?.textContent).toContain('Sign out')
  })

  it('shows New post only with a session, and the button opens compose', async () => {
    const el = await mount()
    expect(el.hasAttribute('can-compose')).toBe(false)
    activeUserKey.value = toUserKey('alice', 'example.social')
    expect(el.hasAttribute('can-compose')).toBe(true)
    const seen: Event[] = []
    const onCompose = (e: Event) => seen.push(e)
    window.addEventListener('caribou:compose', onCompose)
    try {
      const host = el.shadowRoot!.querySelector<CaribouButton>('caribou-button.compose-btn')!
      await host.updateComplete
      host.shadowRoot!.querySelector('button')!.click()
    } finally {
      window.removeEventListener('caribou:compose', onCompose)
    }
    expect(seen).toHaveLength(1)
    activeUserKey.value = null
    expect(el.hasAttribute('can-compose')).toBe(false)
  })

  it('renders New post as a primary caribou-button with the pen and a label', async () => {
    const el = await mount()
    const host = el.shadowRoot!.querySelector<CaribouButton>('caribou-button.compose-btn')!
    await host.updateComplete
    expect(host.variant).toBe('primary')
    // The slotted label names the inner button; the rail clips it, never
    // display: none, where the text is not shown (checked in e2e).
    expect(host.querySelector('.label')?.textContent).toBe('New post')
    expect(host.querySelector('caribou-icon')?.getAttribute('name')).toBe('squarePen')
  })

  // Below desktop the icon is the only thing shown, and it is aria-hidden,
  // so the label is each control's name. display: none would remove it from
  // the accessibility tree; e2e checks the names at narrow viewports.
  it('never hides the labels with display: none', () => {
    const css = (CaribouNavRail.styles as { cssText: string }).cssText
    expect(css).not.toMatch(/\.label\s*\{[^}]*display:\s*none/)
    expect(css).toMatch(/\.label\s*\{[^}]*clip-path/)
  })

  // DOM order is the visual order at every width (WCAG 2.4.3): the phone bar
  // hides the `in-more` items and shows More, it never reorders.
  describe('More menu', () => {
    it('puts New post just above Profile, and More after Profile', async () => {
      const el = await mount()
      const order = [...el.shadowRoot!.querySelector('nav')!.children].map((c) =>
        c.getAttribute('href') ?? c.className)
      expect(order).toEqual(['/home', '/local', '/public', '/bookmarks', 'compose-btn', '/@me', 'more', ''])
    })

    it('marks the bar items the phone moves into the menu', async () => {
      const el = await mount()
      const moved = [...el.shadowRoot!.querySelectorAll('nav > a.in-more')].map((a) => a.getAttribute('href'))
      expect(moved).toEqual(['/public', '/bookmarks'])
    })

    it('holds the moved links and a native sign-out form', async () => {
      const el = await mount('/public')
      const menu = el.shadowRoot!.querySelector('caribou-menu.more')!
      expect(menu.getAttribute('label')).toBe('More')
      expect(menu.getAttribute('icon')).toBe('ellipsis')
      const links = [...menu.querySelectorAll('a.menu-item')]
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/public', '/bookmarks'])
      expect(links[0]!.getAttribute('aria-current')).toBe('page')
      const submit = menu.querySelector('caribou-signout-form form[action="/api/signout"][method="post"] button[type="submit"]')
      expect(submit?.textContent?.trim()).toBe('Sign out')
    })

    it('a menu link navigates in the app', async () => {
      const el = await mount()
      el.shadowRoot!.querySelector<HTMLAnchorElement>('caribou-menu a[href="/public"]')!.click()
      await flush()
      expect(goSpy).toHaveBeenCalledWith('/public')
    })
  })
})
