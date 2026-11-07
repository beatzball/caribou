import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@beatzball/caribou-mastodon-client'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { activeUserKey, users } from '@beatzball/caribou-state'
import { blueskyClients } from './_bluesky-clients.js'
import '../caribou-profile-header.js'
import type { CaribouProfileHeader } from '../caribou-profile-header.js'
import {
  ALICE, BSKY_LABELER, READER_KEY, author, blueskyClient, fakeAgent, label, prefs, signInBluesky,
} from './_bluesky-helpers.js'

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

// The profile header reads `avatar` and `banner` from the account's own
// moderation (#184; README, "Bluesky views"). The account comes from the
// real client's `lookupAccount`, which runs `moderate({ kind: 'profile' })`,
// then goes through JSON.

const PROFILE_SELF = `at://${ALICE}/app.bsky.actor.profile/self`
const BANNER = `https://cdn.bsky.app/img/banner/plain/${ALICE}/bafkreibanner@jpeg`
const WARN = { prefs: prefs({ adultContentEnabled: true, labels: { porn: 'warn' } }) }

async function lookedUp(labels: ReturnType<typeof label>[], mod: Parameters<typeof blueskyClient>[1] = WARN): Promise<Account> {
  const view = { ...author(ALICE, labels), banner: BANNER, description: 'bio', followersCount: 1, followsCount: 2, postsCount: 3 }
  const agent = fakeAgent({ getProfile: vi.fn(async () => ({ data: view })) })
  const account = await blueskyClient(agent, mod).lookupAccount('alice.example.com')
  return JSON.parse(JSON.stringify(account)) as Account
}

async function mount(account: Account, viewerOf: string | null = null): Promise<CaribouProfileHeader> {
  const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
  el.account = account
  el.viewerOf = viewerOf
  document.body.appendChild(el)
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
  }
  return el
}

const text = (el: Element) => el.shadowRoot!.textContent ?? ''

const blurred = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel)!.classList.contains('blurred')

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
})
afterEach(() => { document.body.replaceChildren() })

describe('<caribou-profile-header> for a Bluesky account', () => {
  it('a labeled profile: avatar and banner are blurred', async () => {
    const a = await lookedUp([label('porn', ALICE, PROFILE_SELF)])
    expect(a.bluesky!.moderation!.contexts.avatar.blur).toBe(true)
    const el = await mount(a)
    expect(blurred(el, 'img.avatar')).toBe(true)
    expect(blurred(el, '.banner')).toBe(true)
  })

  it('a labeled account (not just its profile record) is blurred too', async () => {
    const el = await mount(await lookedUp([label('porn', BSKY_LABELER, ALICE)]))
    expect(blurred(el, 'img.avatar')).toBe(true)
    expect(blurred(el, '.banner')).toBe(true)
  })

  it('a clean profile is not', async () => {
    const el = await mount(await lookedUp([]))
    expect(blurred(el, 'img.avatar')).toBe(false)
    expect(blurred(el, '.banner')).toBe(false)
  })

  it('a Bluesky account with no moderation result yet is blurred (fail closed)', async () => {
    const a = await lookedUp([])
    delete a.bluesky!.moderation
    const el = await mount(a)
    expect(blurred(el, 'img.avatar')).toBe(true)
    expect(blurred(el, '.banner')).toBe(true)
  })

  it('a Mastodon account is never blurred', async () => {
    const el = await mount({
      id: '1', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '',
      header: 'https://example.social/h.png', headerStatic: '', note: '',
    } as unknown as Account)
    expect(el.shadowRoot!.querySelector('img.avatar')!.hasAttribute('class')).toBe(true)
    expect(blurred(el, 'img.avatar')).toBe(false)
    expect(blurred(el, '.banner')).toBe(false)
  })
})

describe('<caribou-profile-header>: the profile cover (profileView) and whose decision it is', () => {
  it('a !hide account, signed in: name, handle and bio are covered, with no Show', async () => {
    signInBluesky(blueskyClient(fakeAgent()))
    const a = await lookedUp([label('!hide', BSKY_LABELER, ALICE)], {})
    expect(a.bluesky!.moderation!.contexts.profileView).toMatchObject({ blur: true, noOverride: true })
    const el = await mount(a, READER_KEY)
    expect(el.shadowRoot!.querySelector('.name')).toBeNull()
    expect(el.shadowRoot!.querySelector('.handle')).toBeNull()
    expect(el.shadowRoot!.querySelector('.bio')).toBeNull()
    expect(text(el)).not.toContain('bio')
    expect(el.shadowRoot!.querySelector('.profile-cover')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('button.filter-toggle')).toBeNull()
    expect(blurred(el, 'img.avatar')).toBe(true)
  })

  it('a !warn account, signed in: covered, and Show reveals the name and bio', async () => {
    signInBluesky(blueskyClient(fakeAgent()))
    const el = await mount(await lookedUp([label('!warn', BSKY_LABELER, ALICE)], {}), READER_KEY)
    expect(el.shadowRoot!.querySelector('.name')).toBeNull()
    el.shadowRoot!.querySelector<HTMLElement>('button.filter-toggle')!.click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.name')).not.toBeNull()
    expect(el.shadowRoot!.querySelector('.bio')!.textContent).toContain('bio')
  })

  it('signed out, a !no-unauthenticated account shows only the notice', async () => {
    const a = await lookedUp([label('!no-unauthenticated', ALICE, PROFILE_SELF)])
    const el = await mount(a, null)
    expect(text(el)).toContain('This account asked to be seen only by signed-in readers.')
    expect(el.shadowRoot!.querySelector('.name')).toBeNull()
    expect(el.shadowRoot!.querySelector('.handle')).toBeNull()
    expect(el.shadowRoot!.querySelector('.bio')).toBeNull()
    expect(el.shadowRoot!.querySelector('img.avatar')).toBeNull()
    expect(text(el)).not.toContain('alice')
  })

  it("a decision made for another reader is not used: covered", async () => {
    signInBluesky(blueskyClient(fakeAgent()))
    const el = await mount(await lookedUp([]), 'did:plc:other@bsky')
    expect(el.shadowRoot!.querySelector('.name')).toBeNull()
    expect(blurred(el, 'img.avatar')).toBe(true)
  })

  it('a clean profile for this reader shows everything', async () => {
    signInBluesky(blueskyClient(fakeAgent()))
    const el = await mount(await lookedUp([]), READER_KEY)
    expect(el.shadowRoot!.querySelector('.name')).not.toBeNull()
    expect(blurred(el, 'img.avatar')).toBe(false)
  })
})
