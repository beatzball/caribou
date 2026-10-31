import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, unreadNotificationCount, users, type UserSession } from '@beatzball/caribou-state'
import { toUserKey, type UserKey } from '@beatzball/caribou-auth'
import type { mastodon } from 'masto'
import { LitroRouter } from '@beatzball/litro-router'
import '../caribou-nav-rail.js'
import { CaribouNavRail } from '../caribou-nav-rail.js'
import type { CaribouButton } from '../caribou-button.js'
import { switchToAccount } from '../_switch-account.js'

vi.mock('../_switch-account.js', () => ({ switchToAccount: vi.fn(async () => true) }))

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
    unreadNotificationCount.value = 0
    goSpy.mockClear()
    vi.mocked(switchToAccount).mockClear()
    happyDOM.setURL('http://localhost/')
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders the real nav anchors inside a labelled <nav>', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary')
    const hrefs = [...el.shadowRoot!.querySelectorAll('nav > a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/home', '/local', '/notifications', '/public', '/bookmarks', '/@me'])
    const labels = [...el.shadowRoot!.querySelectorAll('nav > a .label')].map((s) => s.textContent)
    expect(labels).toEqual(['Home', 'Local', 'Notifications', 'Public', 'Bookmarks', 'Profile'])
    const icons = [...el.shadowRoot!.querySelectorAll('nav > a caribou-icon')].map((i) => i.getAttribute('name'))
    expect(icons).toEqual(['home', 'users', 'bell', 'globe', 'bookmark', 'user'])
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

  it('has no Sign out outside a menu: it lives in the account menu', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('nav > caribou-signout-form')).toBeNull()
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
      expect(order).toEqual(['/home', '/local', '/notifications', '/public', '/bookmarks', 'compose-btn', '/@me', 'more', 'account signed-in-only'])
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
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/public', '/bookmarks', '/?add'])
      expect(links[0]!.getAttribute('aria-current')).toBe('page')
      const submit = menu.querySelector('caribou-signout-form form[action="/api/signout"][method="post"] button[type="submit"]')
      expect(submit?.textContent?.trim()).toBe('Sign out')
    })

    it('marks More when a moved item is current, since its bar copy is hidden', async () => {
      const menu = (el: CaribouNavRail) => el.shadowRoot!.querySelector('caribou-menu.more')!
      expect(menu(await mount('/bookmarks')).hasAttribute('data-current')).toBe(true)
      document.body.replaceChildren()
      expect(menu(await mount('/local')).hasAttribute('data-current')).toBe(false)
    })

    it('marks More pending while a moved item\'s page loads', async () => {
      const el = await mount('/local')
      happyDOM.setURL('http://localhost/public')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('caribou-menu.more')!.hasAttribute('data-pending')).toBe(true)
    })

    it('a menu link navigates in the app', async () => {
      const el = await mount()
      el.shadowRoot!.querySelector<HTMLAnchorElement>('caribou-menu a[href="/public"]')!.click()
      await flush()
      expect(goSpy).toHaveBeenCalledWith('/public')
    })
  })

  describe('unread badge', () => {
    const link = (el: CaribouNavRail) => el.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="/notifications"]')!

    it('shows no badge at 0, as the server renders it', async () => {
      const el = await mount()
      expect(link(el).querySelector('.badge')).toBeNull()
      expect(link(el).textContent!.trim()).toBe('Notifications')
    })

    it('shows the count from the signal, and the name reads "Notifications, N unread"', async () => {
      const el = await mount()
      unreadNotificationCount.value = 3
      await el.updateComplete
      const badge = link(el).querySelector('.badge')!
      expect(badge.textContent).toBe('3')
      expect(badge.getAttribute('aria-hidden')).toBe('true')
      // The visible label stays the start of the name; the count follows it
      // in visually-hidden text.
      expect(link(el).getAttribute('aria-label')).toBeNull()
      expect(link(el).querySelector('.sr-only')!.textContent).toBe(', 3 unread')
      expect(link(el).textContent!.replace(/\s+/g, ' ').trim()).toBe('3Notifications, 3 unread')
    })

    it('renders no badge in the first render even when the count is already in', async () => {
      unreadNotificationCount.value = 2
      let badgeAtFirstRender: Element | null | undefined
      const proto = CaribouNavRail.prototype as unknown as { firstUpdated(): void }
      const original = proto.firstUpdated
      const spy = vi.spyOn(proto, 'firstUpdated').mockImplementation(function (this: CaribouNavRail) {
        badgeAtFirstRender = link(this).querySelector('.badge')
        original.call(this)
      })
      const el = await mount()
      spy.mockRestore()
      expect(badgeAtFirstRender).toBeNull()
      expect(link(el).querySelector('.badge')!.textContent).toBe('2')
    })

    it('caps the count at one page', async () => {
      const el = await mount()
      unreadNotificationCount.value = 40
      await el.updateComplete
      expect(link(el).querySelector('.badge')!.textContent).toBe('40+')
      unreadNotificationCount.value = 0
      await el.updateComplete
      expect(link(el).querySelector('.badge')).toBeNull()
    })
  })

  describe('account menu', () => {
    const ALICE = toUserKey('alice', 'one.example')
    const BOB = toUserKey('bob', 'two.example')

    function session(userKey: UserKey, account: Partial<mastodon.v1.Account> | null = null): UserSession {
      return {
        userKey, server: userKey.slice(userKey.indexOf('@') + 1), token: `T-${userKey}`, vapidKey: '',
        account: account as mastodon.v1.Account | null, createdAt: 0,
      }
    }

    function seed(list: UserSession[], active: UserKey | null) {
      users.value = new Map(list.map((u) => [u.userKey, u]))
      activeUserKey.value = active
    }

    const menu = (el: CaribouNavRail) => el.shadowRoot!.querySelector('caribou-menu.account')!
    const items = (el: CaribouNavRail) => [...menu(el).querySelectorAll<HTMLElement>('.account-item')]
    const text = (n: Element | null | undefined) => n?.textContent?.replace(/\s+/g, ' ').trim()
    // The text a screen reader reads: aria-hidden parts left out.
    const name = (n: Element | null | undefined) => {
      if (!n) return undefined
      const copy = n.cloneNode(true) as Element
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
      return text(copy)
    }

    it('with no account, renders the placeholder the server renders, hidden by [signed-out]', async () => {
      const el = await mount()
      expect(el.hasAttribute('signed-out')).toBe(true)
      expect(menu(el).classList.contains('signed-in-only')).toBe(true)
      expect(menu(el).getAttribute('label')).toBe('Accounts')
      expect(items(el)).toHaveLength(0)
      expect(text(menu(el).querySelector('.signout-btn'))).toBe('Sign out')
    })

    it('renders the placeholder in the first render even with accounts stored, as the server does', async () => {
      seed([session(ALICE, { acct: 'alice', displayName: 'Alice' })], ALICE)
      let atFirst: { items: number; name: string | undefined } | undefined
      const proto = CaribouNavRail.prototype as unknown as { firstUpdated(): void }
      const original = proto.firstUpdated
      const spy = vi.spyOn(proto, 'firstUpdated').mockImplementation(function (this: CaribouNavRail) {
        atFirst = { items: items(this).length, name: text(menu(this).querySelector('[slot="trigger"] .who-name')) }
        original.call(this)
      })
      try {
        await mount()
      } finally {
        spy.mockRestore()
      }
      expect(atFirst).toEqual({ items: 0, name: '' })
    })

    it('with one account, shows it as current, with a check, linking to its profile', async () => {
      seed([session(ALICE, { acct: 'alice', displayName: 'Alice', avatar: 'https://one.example/a.png', avatarStatic: '' })], ALICE)
      const el = await mount()
      const [only] = items(el)
      expect(items(el)).toHaveLength(1)
      expect(only!.tagName).toBe('A')
      expect(only!.getAttribute('href')).toBe('/@me')
      expect(only!.getAttribute('aria-current')).toBe('true')
      expect(only!.querySelector('caribou-icon.check')?.getAttribute('name')).toBe('check')
      expect(name(only)).toBe('Signed in as Alice @alice@one.example')
      expect(only!.querySelector('img.avatar')?.getAttribute('src')).toBe('https://one.example/a.png')
      expect(only!.querySelector('img.avatar')?.getAttribute('alt')).toBe('')
      // The trigger shows the current account.
      const trigger = menu(el).querySelector('[slot="trigger"]')!
      expect(text(trigger.querySelector('.who-name'))).toBe('Alice')
      expect(text(trigger.querySelector('.who-acct'))).toBe('@alice@one.example')
    })

    it('with two accounts, puts the current one first and names the other "Switch to"', async () => {
      seed([session(ALICE, { acct: 'alice', displayName: 'Alice' }), session(BOB, { acct: 'bob', displayName: 'Bob' })], BOB)
      const el = await mount()
      const list = items(el)
      expect(list.map(name)).toEqual(['Signed in as Bob @bob@two.example', 'Switch to Alice @alice@one.example'])
      expect(list[0]!.getAttribute('aria-current')).toBe('true')
      expect(list[1]!.tagName).toBe('BUTTON')
      expect(list[1]!.getAttribute('aria-current')).toBeNull()
      expect(list[1]!.querySelector('.check')).toBeNull()
    })

    it('shows an account not loaded yet by its handle and a letter avatar', async () => {
      seed([session(ALICE, { acct: 'alice', displayName: 'Alice' }), session(BOB)], ALICE)
      const el = await mount()
      const other = items(el)[1]!
      expect(name(other)).toBe('Switch to bob @bob@two.example')
      expect(other.querySelector('img')).toBeNull()
      const letter = other.querySelector('span.avatar')!
      expect(letter.textContent).toBe('b')
      expect(letter.getAttribute('aria-hidden')).toBe('true')
    })

    it('clicking another account switches to it', async () => {
      seed([session(ALICE), session(BOB)], ALICE)
      const el = await mount()
      items(el)[1]!.click()
      expect(switchToAccount).toHaveBeenCalledWith(BOB)
    })

    it('clicking the current account goes to its profile in the app', async () => {
      seed([session(ALICE)], ALICE)
      const el = await mount()
      items(el)[0]!.click()
      await flush()
      expect(goSpy).toHaveBeenCalledWith('/@me')
      expect(switchToAccount).not.toHaveBeenCalled()
    })

    it('offers Add account, then a native "Sign out of @name" form', async () => {
      seed([session(ALICE, { acct: 'alice' }), session(BOB)], ALICE)
      const el = await mount()
      const add = menu(el).querySelector('a[href="/?add"]')
      expect(text(add)).toBe('Add account')
      const submit = menu(el).querySelector('caribou-signout-form form[action="/api/signout"][method="post"] button[type="submit"]')
      expect(text(submit)).toBe('Sign out of @alice@one.example')
      // Order: accounts, Add account, Sign out.
      const order = [...menu(el).children].filter((c) => c.getAttribute('slot') !== 'trigger')
        .map((c) => c.tagName.toLowerCase())
      expect(order).toEqual(['a', 'button', 'a', 'caribou-signout-form'])
    })

    it('follows the stored accounts after hydration', async () => {
      const el = await mount()
      seed([session(ALICE)], ALICE)
      await el.updateComplete
      expect(items(el).map(name)).toEqual(['Signed in as alice @alice@one.example'])
      users.value = new Map([[ALICE, session(ALICE, { acct: 'alice', displayName: 'Alice' })]])
      await el.updateComplete
      expect(name(items(el)[0])).toBe('Signed in as Alice @alice@one.example')
    })

    it('repeats the same items at the end of the More menu, for the phone', async () => {
      seed([session(ALICE), session(BOB)], BOB)
      const el = await mount()
      const more = el.shadowRoot!.querySelector('caribou-menu.more')!
      expect([...more.querySelectorAll('.account-item')].map(name))
        .toEqual(['Signed in as bob @bob@two.example', 'Switch to alice @alice@one.example'])
      expect(more.querySelector('a[href="/?add"]')).not.toBeNull()
      expect(text(more.querySelector('caribou-signout-form button'))).toBe('Sign out of @bob@two.example')
    })

    it('keeps the trigger content out of hit-testing, so link hints find the button (#111)', async () => {
      const el = await mount()
      const menuEl = menu(el) as unknown as { updateComplete: Promise<boolean>; constructor: { styles: { cssText: string }[] } }
      await menuEl.updateComplete
      const css = menuEl.constructor.styles.map((x) => x.cssText).join('\n')
      expect(css).toMatch(/::slotted\(\[slot="trigger"\]\)[^{]*\{[^}]*pointer-events:\s*none/)
    })
  })
})
