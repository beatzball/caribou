import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@beatzball/caribou-mastodon-client'
import '../caribou-profile-header.js'
import type { CaribouProfileHeader } from '../caribou-profile-header.js'
import {
  ALICE, BSKY_LABELER, author, blueskyClient, fakeAgent, label, prefs,
} from './_bluesky-helpers.js'

// The profile header reads `avatar` and `banner` from the account's own
// moderation (#184; README, "Bluesky views"). The account comes from the
// real client's `lookupAccount`, which runs `moderate({ kind: 'profile' })`,
// then goes through JSON.

const PROFILE_SELF = `at://${ALICE}/app.bsky.actor.profile/self`
const BANNER = `https://cdn.bsky.app/img/banner/plain/${ALICE}/bafkreibanner@jpeg`
const WARN = { prefs: prefs({ adultContentEnabled: true, labels: { porn: 'warn' } }) }

async function lookedUp(labels: ReturnType<typeof label>[], mod = WARN): Promise<Account> {
  const view = { ...author(ALICE, labels), banner: BANNER, description: 'bio', followersCount: 1, followsCount: 2, postsCount: 3 }
  const agent = fakeAgent({ getProfile: vi.fn(async () => ({ data: view })) })
  const account = await blueskyClient(agent, mod).lookupAccount('alice.example.com')
  return JSON.parse(JSON.stringify(account)) as Account
}

async function mount(account: Account): Promise<CaribouProfileHeader> {
  const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
  el.account = account
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const blurred = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel)!.classList.contains('blurred')

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
