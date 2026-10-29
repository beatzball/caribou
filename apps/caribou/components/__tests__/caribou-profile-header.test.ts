import { afterEach, describe, expect, it, vi } from 'vitest'
import { batch } from '@preact/signals-core'
import type { Account, Relationship } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, relationshipCache, users, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-profile-header.js'
import type { CaribouProfileHeader } from '../caribou-profile-header.js'
import type { CaribouButton } from '../caribou-button.js'
import { mastodonLinkText } from '../_shared-styles.js'
import { CaribouStatusCard } from '../caribou-status-card.js'

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: '', avatarStatic: '', note: '<p>bio</p>', followersCount: 10, followingCount: 20, statusesCount: 30,
  header: '', headerStatic: '',
} as unknown as Account

async function mount(account: Account | null): Promise<CaribouProfileHeader> {
  const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
  el.account = account
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('<caribou-profile-header>', () => {
  afterEach(() => {
    document.body.replaceChildren()
    activeUserKey.value = null
    users.value = new Map()
    relationshipCache.value = new Map()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  // A link in a bio is shortened the same way as one in a post.
  it('shares the Mastodon link-text styles with the status card', () => {
    const header = customElements.get('caribou-profile-header') as unknown as typeof CaribouProfileHeader
    expect(header.styles).toContain(mastodonLinkText)
    expect(CaribouStatusCard.styles).toContain(mastodonLinkText)
  })

  it('renders avatar, display name, handle, bio, counts', async () => {
    const el = await mount(ACCOUNT)
    const root = el.shadowRoot!
    expect(root.querySelector('img.avatar')).not.toBeNull()
    expect(root.querySelector('.name')?.textContent).toBe('Alice')
    expect(root.querySelector('.handle')?.textContent).toBe('@alice@example.social')
    expect(root.querySelector('.bio')?.innerHTML).toContain('<p>bio</p>')
    const counts = [...root.querySelectorAll('.counts span')].map((s) => s.textContent?.trim())
    expect(counts).toEqual(['30 Posts', '20 Following', '10 Followers'])
  })

  it('falls back to the username when there is no display name', async () => {
    const el = await mount({ ...ACCOUNT, displayName: '' })
    expect(el.shadowRoot!.querySelector('.name')?.textContent).toBe('alice')
  })

  it('sanitizes the bio on the client', async () => {
    const el = await mount({ ...ACCOUNT, note: '<p onclick="alert(1)">bio</p>' })
    const p = el.shadowRoot!.querySelector('.bio p')!
    expect(p.textContent).toBe('bio')
    expect(p.hasAttribute('onclick')).toBe(false)
  })

  // This file loads the header without the status card, so the hook must
  // come from the header's own install.
  it('adds noopener and noreferrer to a new-window link in the bio', async () => {
    const el = await mount({ ...ACCOUNT, note: '<p><a href="https://example.com" target="_blank">site</a></p>' })
    expect(el.shadowRoot!.querySelector('.bio a')!.getAttribute('rel')).toBe('noopener noreferrer')
  })

  // Hydration compares the bio against the server's HTML by digest, so the
  // render that adopts a server-made shadow root must print the note as the
  // server did. Every later render sanitizes.
  it('trusts the note only for the render that adopts a server-made shadow root', async () => {
    const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
    el.attachShadow({ mode: 'open' })
    el.account = { ...ACCOUNT, note: '<p data-from-server="">bio</p>' }
    document.body.appendChild(el)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.bio p')?.hasAttribute('data-from-server')).toBe(true)

    el.account = { ...ACCOUNT, note: '<p onclick="alert(1)">next</p>' }
    await el.updateComplete
    const p = el.shadowRoot!.querySelector('.bio p')!
    expect(p.textContent).toBe('next')
    expect(p.hasAttribute('onclick')).toBe(false)
  })

  it('paints the banner image only when the account has one', async () => {
    const plain = await mount(ACCOUNT)
    expect(plain.shadowRoot!.querySelector('.banner')?.getAttribute('style')).toBeNull()
    const withBanner = await mount({ ...ACCOUNT, headerStatic: 'https://example.social/banner.png' })
    expect(withBanner.shadowRoot!.querySelector('.banner')?.getAttribute('style'))
      .toContain('url("https://example.social/banner.png")')
  })

  it('renders nothing until it has an account', async () => {
    const el = await mount(null)
    expect(el.shadowRoot!.querySelector('.row')).toBeNull()
  })
})

const ME = { ...ACCOUNT, id: '1', acct: 'me', username: 'me' } as unknown as Account

function rel(patch: Partial<Relationship> = {}): Relationship {
  return { id: '42', following: false, requested: false, followedBy: false, ...patch } as Relationship
}

function signIn(server = 'example.social'): NonNullable<typeof activeClient.value> {
  addUserSession({
    userKey: `me@${server}`, server, token: 'TOKEN', vapidKey: '', account: ME, createdAt: 1,
  } as unknown as UserSession)
  return activeClient.value!
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function mountWith(account: Account, instance = 'example.social'): Promise<CaribouProfileHeader> {
  const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
  el.account = account
  el.instance = instance
  document.body.appendChild(el)
  await el.updateComplete
  await flush()
  await el.updateComplete
  return el
}

const button = (el: CaribouProfileHeader) => el.shadowRoot!.querySelector<CaribouButton>('caribou-button.follow')
// The real button; a click on the host would pass even with no component.
const inner = (el: CaribouProfileHeader) => button(el)!.shadowRoot!.querySelector('button')!
// What a screen reader and a sighted reader see: the label that is displayed.
const visibleLabel = (b: HTMLElement) =>
  [...b.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && !n.classList.contains('hover')))
    .map((n) => n.textContent).join('')

describe('<caribou-profile-header> follow button', () => {
  afterEach(() => {
    document.body.replaceChildren()
    activeUserKey.value = null
    users.value = new Map()
    relationshipCache.value = new Map()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  // The server has no session; the first client render must equal its HTML.
  it('renders no button before mount and none when signed out', async () => {
    const el = document.createElement('caribou-profile-header') as CaribouProfileHeader
    el.account = ACCOUNT
    document.body.appendChild(el)
    await el.updateComplete
    expect(button(el)).toBeNull()
    await flush()
    expect(button(el)).toBeNull()
  })

  it('shows Follow, then Following with Unfollow on hover, and unfollows again', async () => {
    const client = signIn()
    const fetchRel = vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    const follow = vi.spyOn(client, 'follow').mockResolvedValue(rel({ following: true }))
    const unfollow = vi.spyOn(client, 'unfollow').mockResolvedValue(rel())
    const el = await mountWith(ACCOUNT)
    expect(fetchRel).toHaveBeenCalledWith(['42'])
    expect(button(el)?.textContent).toBe('Follow')
    expect(button(el)?.dataset.state).toBe('follow')
    expect(button(el)?.variant).toBe('primary')
    expect(button(el)!.parentElement?.getAttribute('aria-live')).toBe('polite')

    inner(el).click()
    await el.updateComplete
    expect(button(el)?.dataset.state).toBe('following')
    expect(button(el)?.variant).toBe('secondary')
    expect(visibleLabel(button(el)!)).toBe('Following')
    expect(button(el)!.querySelector('.hover')?.textContent).toBe('Unfollow')
    expect(follow).toHaveBeenCalledWith('42')
    await flush()

    inner(el).click()
    await el.updateComplete
    expect(button(el)?.textContent).toBe('Follow')
    expect(unfollow).toHaveBeenCalledWith('42')
  })

  it('shows Requested for a locked account, and a click withdraws the request', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ requested: true })])
    const unfollow = vi.spyOn(client, 'unfollow').mockResolvedValue(rel())
    const el = await mountWith({ ...ACCOUNT, locked: true } as Account)
    expect(button(el)?.textContent).toBe('Requested')
    expect(button(el)?.variant).toBe('secondary')
    inner(el).click()
    await el.updateComplete
    expect(button(el)?.textContent).toBe('Follow')
    expect(unfollow).toHaveBeenCalledWith('42')
  })

  it('says "Follows you" when the account follows the reader', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ followedBy: true })])
    const el = await mountWith(ACCOUNT)
    expect(el.shadowRoot!.querySelector('.follows-you')?.textContent).toBe('Follows you')
  })

  it('hides the button on the reader’s own profile', async () => {
    const client = signIn()
    const fetchRel = vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    const el = await mountWith(ME)
    expect(button(el)).toBeNull()
    expect(fetchRel).not.toHaveBeenCalled()
  })

  it('looks the account up on the reader’s server when the profile is from another instance', async () => {
    const client = signIn('home.example')
    const local = { ...ACCOUNT, id: '900' } as Account
    const lookup = vi.spyOn(client, 'lookupAccount').mockResolvedValue(local)
    const fetchRel = vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ id: '900' })])
    const follow = vi.spyOn(client, 'follow').mockResolvedValue(rel({ id: '900', following: true }))
    const el = await mountWith({ ...ACCOUNT, acct: 'alice' } as Account, 'example.social')
    expect(lookup).toHaveBeenCalledWith('alice@example.social')
    expect(fetchRel).toHaveBeenCalledWith(['900'])
    inner(el).click()
    expect(follow).toHaveBeenCalledWith('900')
  })

  it('hides the button when the reader’s server does not know the account', async () => {
    const client = signIn('home.example')
    vi.spyOn(client, 'lookupAccount').mockRejectedValue(new Error('not found'))
    const fetchRel = vi.spyOn(client, 'fetchRelationships')
    const el = await mountWith(ACCOUNT, 'example.social')
    expect(button(el)).toBeNull()
    expect(fetchRel).not.toHaveBeenCalled()
  })

  // Without a host the header cannot tell which server the account id
  // belongs to, and the active client could read it as someone else.
  it('shows no button when it does not know the account’s instance', async () => {
    const client = signIn()
    const fetchRel = vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    const follow = vi.spyOn(client, 'follow')
    const el = await mountWith(ACCOUNT, '')
    expect(button(el)).toBeNull()
    expect(fetchRel).not.toHaveBeenCalled()
    expect(follow).not.toHaveBeenCalled()
  })

  // Signed in as one user, the profile loaded; then the reader switched to a
  // session on another server. The id came from the first server.
  it('looks the account up again after a switch to a session on another server', async () => {
    const first = signIn('one.example')
    vi.spyOn(first, 'fetchRelationships').mockResolvedValue([rel()])
    const firstFollow = vi.spyOn(first, 'follow')
    const el = await mountWith({ ...ACCOUNT, acct: 'alice' } as Account, 'one.example')
    expect(button(el)).not.toBeNull()

    // The header reacts to the switch at once; `batch` holds that back until
    // the new session's client is stubbed.
    const { lookup, follow } = batch(() => {
      addUserSession({
        userKey: 'bob@two.example', server: 'two.example', token: 'TOKEN-2',
        vapidKey: '', account: { ...ME, id: '2' }, createdAt: 2,
      } as unknown as UserSession)
      const second = activeClient.value!
      vi.spyOn(second, 'fetchRelationships').mockResolvedValue([rel({ id: '555' })])
      return {
        lookup: vi.spyOn(second, 'lookupAccount').mockResolvedValue({ ...ACCOUNT, id: '555' } as Account),
        follow: vi.spyOn(second, 'follow').mockResolvedValue(rel({ id: '555', following: true })),
      }
    })
    await flush()
    await el.updateComplete
    expect(lookup).toHaveBeenCalledWith('alice@one.example')
    inner(el).click()
    expect(follow).toHaveBeenCalledWith('555')
    expect(follow).not.toHaveBeenCalledWith('42')
    expect(firstFollow).not.toHaveBeenCalled()
  })

  it('removes the button on sign-out', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    const el = await mountWith(ACCOUNT)
    expect(button(el)).not.toBeNull()
    activeUserKey.value = null
    await el.updateComplete
    expect(button(el)).toBeNull()
  })
})
