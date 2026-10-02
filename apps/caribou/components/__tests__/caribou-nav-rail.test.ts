import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, users } from '@beatzball/caribou-state'
import { toUserKey } from '@beatzball/caribou-auth'
import { LitroRouter } from '@beatzball/litro-router'
import '../caribou-nav-rail.js'
import { CaribouNavRail } from '../caribou-nav-rail.js'

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

  it('renders four real nav anchors inside a labelled <nav>', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary')
    const hrefs = [...el.shadowRoot!.querySelectorAll('nav > a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/home', '/local', '/public', '/@me'])
    const labels = [...el.shadowRoot!.querySelectorAll('nav > a .label')].map((s) => s.textContent)
    expect(labels).toEqual(['Home', 'Local', 'Public', 'Profile'])
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
})
