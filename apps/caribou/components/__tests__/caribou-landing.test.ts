import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { activeUserKey, users, type UserSession } from '@beatzball/caribou-state'
import '../caribou-landing.js'
import { signedInAs, type CaribouLanding } from '../caribou-landing.js'
import type { CaribouInstancePicker } from '../caribou-instance-picker.js'

async function mount(add = false): Promise<CaribouLanding> {
  const el = document.createElement('caribou-landing') as CaribouLanding
  el.add = add
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

function session(name: string, server: string): UserSession {
  return {
    userKey: toUserKey(name, server), server, token: `T-${name}`, vapidKey: '', account: null, createdAt: 0,
  }
}

function seed(...sessions: UserSession[]) {
  users.value = new Map(sessions.map((s) => [s.userKey, s]))
  activeUserKey.value = sessions.at(-1)?.userKey ?? null
}

describe('caribou-landing', () => {
  beforeEach(() => seed())
  afterEach(() => {
    document.body.replaceChildren()
    seed()
  })

  it('renders the heading and the intro inside <main>', async () => {
    const el = await mount()
    const main = el.shadowRoot!.querySelector('main')!
    expect(main.querySelector('h1')?.textContent).toBe('Caribou')
    expect(main.querySelector('p')?.textContent?.trim()).toBe('A Mastodon client. Enter your instance to sign in.')
  })

  it('renders the error banner above the instance picker', async () => {
    const el = await mount()
    const tags = [...el.shadowRoot!.querySelectorAll('main > *')].map((c) => c.localName)
    expect(tags).toEqual(['h1', 'p', 'caribou-error-banner', 'caribou-instance-picker'])
  })

  it('without add, a signed-in reader still gets the plain landing', async () => {
    seed(session('bob', 'two.example'))
    const el = await mount()
    expect(el.shadowRoot!.querySelector('h1')?.textContent).toBe('Caribou')
    expect(el.shadowRoot!.querySelector('.who')).toBeNull()
    expect(el.shadowRoot!.querySelector<CaribouInstancePicker>('caribou-instance-picker')!.add).toBe(false)
  })

  describe('add', () => {
    it('renders the add form: heading, who line, banner, picker in add mode, Cancel link', async () => {
      seed(session('bob', 'two.example'))
      const el = await mount(true)
      const main = el.shadowRoot!.querySelector('main')!
      expect(main.querySelector('h1')?.textContent).toBe('Add an account')
      const tags = [...main.children].map((c) => c.localName + (c.className ? `.${c.className}` : ''))
      expect(tags).toEqual(['h1', 'p', 'p.who', 'caribou-error-banner', 'caribou-instance-picker', 'p.cancel'])
      expect((main.querySelector('caribou-instance-picker') as CaribouInstancePicker).add).toBe(true)
      const cancel = main.querySelector<HTMLAnchorElement>('.cancel a')!
      expect(cancel.getAttribute('href')).toBe('/home')
      expect(cancel.textContent).toBe('Cancel')
    })

    // The server cannot see the accounts; the first client render has to
    // match it, so the line is empty until the first update is done.
    it('the who line is empty in the first render, then names the account', async () => {
      seed(session('bob', 'two.example'))
      const el = document.createElement('caribou-landing') as CaribouLanding
      el.add = true
      let first = ''
      // Read the line between the first render and `firstUpdated`.
      const hook = el as unknown as { firstUpdated(...args: unknown[]): void }
      const origFirstUpdated = hook.firstUpdated
      hook.firstUpdated = function (this: CaribouLanding, ...args: unknown[]) {
        first = this.shadowRoot!.querySelector('.who')!.textContent!.trim()
        return origFirstUpdated.apply(this, args)
      }
      document.body.appendChild(el)
      await el.updateComplete
      await el.updateComplete
      expect(first).toBe('')
      expect(el.shadowRoot!.querySelector('.who')!.textContent!.trim()).toBe('You are signed in as @bob@two.example.')
    })

    it('follows the accounts after the first render', async () => {
      seed(session('bob', 'two.example'))
      const el = await mount(true)
      await el.updateComplete
      seed(session('alice', 'one.example'), session('bob', 'two.example'))
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('.who')!.textContent!.trim())
        .toBe('You are signed in as @bob@two.example.')
      activeUserKey.value = toUserKey('alice', 'one.example')
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('.who')!.textContent!.trim())
        .toBe('You are signed in as @alice@one.example.')
    })

    it('signed out (a stale link): the plain landing after hydration', async () => {
      const el = await mount(true)
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('h1')!.textContent).toBe('Caribou')
      expect(el.shadowRoot!.querySelector('.who')).toBeNull()
      expect(el.shadowRoot!.querySelector('.cancel')).toBeNull()
      expect(el.shadowRoot!.querySelector<CaribouInstancePicker>('caribou-instance-picker')!.add).toBe(false)
    })

    it('the last account signs out elsewhere: the add form becomes the plain landing', async () => {
      seed(session('bob', 'two.example'))
      const el = await mount(true)
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('h1')!.textContent).toBe('Add an account')
      seed()
      await el.updateComplete
      expect(el.shadowRoot!.querySelector('h1')!.textContent).toBe('Caribou')
    })

    it('the who line carries the full text in its title (a long handle may be cut)', async () => {
      seed(session('a-very-long-username-indeed', 'social.example-instance.org'))
      const el = await mount(true)
      await el.updateComplete
      const who = el.shadowRoot!.querySelector('.who')!
      expect(who.getAttribute('title')).toBe('You are signed in as @a-very-long-username-indeed@social.example-instance.org.')
      expect(who.textContent!.trim()).toBe(who.getAttribute('title'))
    })
  })
})

describe('signedInAs', () => {
  it('names the active account, or nothing', () => {
    expect(signedInAs(null)).toBe('')
    expect(signedInAs(session('bob', 'two.example'))).toBe('You are signed in as @bob@two.example.')
  })

  it('uses the loaded account handle when there is one', () => {
    const bob = { ...session('bob', 'two.example'), account: { acct: 'Bob' } as UserSession['account'] }
    expect(signedInAs(bob)).toBe('You are signed in as @Bob@two.example.')
  })
})
