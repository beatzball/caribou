import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, users, type UserSession } from '@beatzball/caribou-state'
import { toUserKey, type UserKey } from '@beatzball/caribou-auth'
import type { mastodon } from 'masto'
import type { LitElement } from 'lit'
import '../caribou-settings.js'
import { SETTINGS_SECTIONS } from '../_settings-sections.js'
import { startTheme } from '../_theme.js'
import { switchToAccount } from '../_switch-account.js'
import { PACKAGE_VERSION } from '../../server/build-meta.generated.js'

vi.mock('../_switch-account.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  switchToAccount: vi.fn(async () => true),
}))

const alice = toUserKey('alice', 'example.social')
const bob = toUserKey('bob', 'other.example')

function session(userKey: UserKey, account: Partial<mastodon.v1.Account> | null = null): UserSession {
  return {
    userKey, server: userKey.split('@')[1]!, token: 'T', vapidKey: '',
    account: account as mastodon.v1.Account | null, createdAt: 1,
  }
}

function signIn(...list: UserSession[]) {
  users.value = new Map(list.map((u) => [u.userKey, u]))
  activeUserKey.value = list[0]?.userKey ?? null
}

async function settle(el: LitElement) {
  while (!(await el.updateComplete)) { /* follow-up update */ }
}

// The settings element and each section element, all settled.
async function mount(attrs: Record<string, string> = {}): Promise<ShadowRoot> {
  const el = document.createElement('caribou-settings') as LitElement
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.append(el)
  await settle(el)
  for (const child of el.shadowRoot!.querySelectorAll('*')) {
    if ('updateComplete' in child) await settle(child as LitElement)
  }
  return el.shadowRoot!
}

const section = (root: ShadowRoot, id: string) => root.querySelector(`section#${id}`)!
const inner = (root: ShadowRoot, id: string) => section(root, id).firstElementChild!.nextElementSibling!.shadowRoot!
const prefs = () => JSON.parse(localStorage.getItem(`caribou.prefs.${alice}`) ?? '{}') as Record<string, unknown>

describe('caribou-settings', () => {
  let stopTheme: (() => void) | undefined

  beforeEach(() => {
    localStorage.clear()
    signIn(session(alice, { acct: 'alice', displayName: 'Alice A', avatarStatic: 'https://example.social/a.png' }), session(bob))
  })

  afterEach(() => {
    stopTheme?.()
    stopTheme = undefined
    document.body.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
    users.value = new Map()
    activeUserKey.value = null
  })

  it('renders a heading and one labelled section per entry of SETTINGS_SECTIONS', async () => {
    const root = await mount()
    expect(root.querySelector('h1')?.textContent).toBe('Settings')
    const sections = [...root.querySelectorAll('section')]
    expect(sections.map((s) => s.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id))
    expect(sections.map((s) => s.id)).toEqual(['appearance', 'timeline', 'account', 'about'])
    for (const s of sections) {
      const h2 = s.querySelector('h2')!
      expect(s.getAttribute('aria-labelledby')).toBe(h2.id)
      expect(h2.textContent).toBe(SETTINGS_SECTIONS.find((x) => x.id === s.id)!.heading)
    }
  })

  it('without storage, notes that settings cannot be saved', async () => {
    const root = await mount({ 'storage-blocked': '' })
    expect(root.querySelector('.note')?.textContent).toMatch(/cannot save settings/i)
    expect((await mount()).querySelector('.note')).toBeNull()
  })

  it('scrolls to the section named in the URL fragment', async () => {
    const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM
    happyDOM.setURL('http://localhost/settings#account')
    const scroll = vi.fn()
    const proto = HTMLElement.prototype as unknown as { scrollIntoView: () => void }
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: HTMLElement) { scroll(this.id) }
    try {
      await mount()
      expect(scroll).toHaveBeenCalledWith('account')
    } finally {
      proto.scrollIntoView = original
      happyDOM.setURL('http://localhost/')
    }
  })

  // A write that storage refuses (full, or blocked) must not look saved.
  function refuseWrites() {
    return vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
  }

  describe('theme', () => {
    const radios = (root: ShadowRoot) =>
      [...inner(root, 'appearance').querySelectorAll<HTMLInputElement>('input[name="theme"]')]

    it('offers dark, light and system, with dark checked by default', async () => {
      const list = radios(await mount())
      expect(list.map((r) => r.value)).toEqual(['dark', 'light', 'system'])
      expect(list.map((r) => r.closest('label')!.textContent!.trim().split(/\s+/)[0])).toEqual(['Dark', 'Light', 'System'])
      expect(list.find((r) => r.checked)?.value).toBe('dark')
    })

    it('checks the stored theme', async () => {
      localStorage.setItem(`caribou.prefs.${alice}`, JSON.stringify({ theme: 'system' }))
      expect(radios(await mount()).find((r) => r.checked)?.value).toBe('system')
    })

    it('saves a choice and applies it at once', async () => {
      stopTheme = startTheme(window, document)
      const list = radios(await mount())
      list[1]!.checked = true
      list[1]!.dispatchEvent(new Event('change', { bubbles: true }))
      expect(prefs().theme).toBe('light')
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    it('a refused save keeps the stored choice and says so', async () => {
      stopTheme = startTheme(window, document)
      const root = await mount()
      const list = radios(root)
      const spy = refuseWrites()
      try {
        list[1]!.checked = true
        list[1]!.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(root.host.shadowRoot!.querySelector('caribou-settings-appearance') as LitElement)
      } finally {
        spy.mockRestore()
      }
      expect(list.find((r) => r.checked)?.value).toBe('dark')
      expect(document.documentElement.dataset.theme).toBe('dark')
      const status = inner(root, 'appearance').querySelector('[role="status"]')!
      expect(status.textContent).toMatch(/not saved/i)
    })
  })

  describe('default timeline', () => {
    const radios = (root: ShadowRoot) =>
      [...inner(root, 'timeline').querySelectorAll<HTMLInputElement>('input[name="default-timeline"]')]

    it('offers home, local and public, with home checked by default', async () => {
      const list = radios(await mount())
      expect(list.map((r) => r.value)).toEqual(['home', 'local', 'public'])
      expect(list.find((r) => r.checked)?.value).toBe('home')
    })

    it('saves a choice next to the other preferences', async () => {
      localStorage.setItem(`caribou.prefs.${alice}`, JSON.stringify({ theme: 'light', lastSeenNotificationId: '7' }))
      const list = radios(await mount())
      list[2]!.checked = true
      list[2]!.dispatchEvent(new Event('change', { bubbles: true }))
      expect(prefs()).toEqual({ theme: 'light', lastSeenNotificationId: '7', defaultTimeline: 'public' })
    })

    it('a refused save keeps the stored choice and says so', async () => {
      const root = await mount()
      const list = radios(root)
      const spy = refuseWrites()
      try {
        list[1]!.checked = true
        list[1]!.dispatchEvent(new Event('change', { bubbles: true }))
        await settle(root.host.shadowRoot!.querySelector('caribou-settings-timeline') as LitElement)
      } finally {
        spy.mockRestore()
      }
      expect(list.find((r) => r.checked)?.value).toBe('home')
      expect(inner(root, 'timeline').querySelector('[role="status"]')!.textContent).toMatch(/not saved/i)
    })

    it('a saved choice clears the message', async () => {
      const root = await mount()
      const list = radios(root)
      const spy = refuseWrites()
      list[1]!.checked = true
      list[1]!.dispatchEvent(new Event('change', { bubbles: true }))
      spy.mockRestore()
      list[2]!.checked = true
      list[2]!.dispatchEvent(new Event('change', { bubbles: true }))
      await settle(root.host.shadowRoot!.querySelector('caribou-settings-timeline') as LitElement)
      expect(list.find((r) => r.checked)?.value).toBe('public')
      expect(inner(root, 'timeline').querySelector('[role="status"]')!.textContent!.trim()).toBe('')
    })
  })

  // The unread dot is on the Settings nav item; this is where it leads.
  describe('about', () => {
    it('names the version and links to the changelog, with its dot', async () => {
      const root = inner(await mount(), 'about')
      expect(root.textContent).toContain(`Caribou ${PACKAGE_VERSION}`)
      const link = root.querySelector('a[href="/changelog"]')!
      expect(link.querySelector('.label')!.textContent).toBe('Changelog')
      expect(link.querySelector('caribou-changelog-dot:not([text])')).not.toBeNull()
      expect(link.querySelector('caribou-changelog-dot[text]')).not.toBeNull()
    })
  })

  describe('account', () => {
    it('shows who is signed in and the account actions', async () => {
      const root = inner(await mount(), 'account')
      expect(root.querySelector('.who-name')?.textContent).toBe('Alice A')
      expect(root.querySelector('.who-acct')?.textContent).toBe('@alice@example.social')
      expect(root.querySelector('img')?.getAttribute('src')).toBe('https://example.social/a.png')
      const links = [...root.querySelectorAll('a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')])
      expect(links).toEqual([['Your profile', '/@me'], ['Add account', '/?add']])
      const form = root.querySelector('caribou-signout-form form') as HTMLFormElement
      expect(form.getAttribute('action')).toBe('/api/signout')
      expect(form.getAttribute('method')).toBe('post')
      expect(form.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Sign out of @alice@example.social')
    })

    it('switches to another stored account', async () => {
      const root = inner(await mount(), 'account')
      const button = [...root.querySelectorAll('button')].find((b) => b.textContent!.includes('@bob@other.example'))!
      expect(button.textContent!.trim()).toBe('Switch to @bob@other.example')
      button.click()
      expect(switchToAccount).toHaveBeenCalledWith(bob)
    })

    it('follows the account once it loads', async () => {
      signIn(session(alice))
      const el = document.createElement('caribou-settings') as LitElement
      document.body.append(el)
      await settle(el)
      const account = el.shadowRoot!.querySelector('caribou-settings-account') as LitElement
      await settle(account)
      expect(account.shadowRoot!.querySelector('.who-name')?.textContent).toBe('alice')
      users.value = new Map([[alice, session(alice, { acct: 'alice', displayName: 'Alice A' })]])
      await settle(account)
      expect(account.shadowRoot!.querySelector('.who-name')?.textContent).toBe('Alice A')
    })
  })
})
