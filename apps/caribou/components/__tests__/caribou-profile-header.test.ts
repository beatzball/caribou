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
    expect(follow).toHaveBeenCalledWith({ id: '42' })
    await flush()

    inner(el).click()
    await el.updateComplete
    expect(button(el)?.textContent).toBe('Follow')
    expect(unfollow).toHaveBeenCalledWith({ id: '42' })
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
    expect(unfollow).toHaveBeenCalledWith({ id: '42' })
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
    expect(follow).toHaveBeenCalledWith({ id: '900' })
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
    expect(follow).toHaveBeenCalledWith({ id: '555' })
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

describe('<caribou-profile-header> mute and block', () => {
  afterEach(() => {
    document.body.replaceChildren()
    activeUserKey.value = null
    users.value = new Map()
    relationshipCache.value = new Map()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  const item = (el: CaribouProfileHeader, action: string) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(`caribou-menu.more button[data-action="${action}"]`)
  const badges = (el: CaribouProfileHeader) =>
    [...el.shadowRoot!.querySelectorAll('.badge')].map((b) => b.textContent)
  const settle = async (el: CaribouProfileHeader) => {
    await flush()
    await el.updateComplete
  }

  it('has no menu signed out', async () => {
    const el = await mountWith(ACCOUNT)
    expect(el.shadowRoot!.querySelector('caribou-menu')).toBeNull()
  })

  it('a menu beside Follow names the account in Mute and Block', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    const el = await mountWith(ACCOUNT)
    expect(el.shadowRoot!.querySelector('caribou-menu.more')!.getAttribute('label')).toBe('More actions for @alice@example.social')
    expect(item(el, 'mute')!.textContent).toBe('Mute @alice@example.social')
    expect(item(el, 'block')!.textContent).toBe('Block @alice@example.social')
    expect(badges(el)).toEqual([])
  })

  it('Add to lists opens the reader\'s lists for the account, as the reader\'s server knows it', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ following: true })])
    vi.spyOn(client, 'fetchLists').mockResolvedValue([])
    const read = vi.spyOn(client, 'fetchAccountLists').mockResolvedValue([])
    const el = await mountWith(ACCOUNT)
    expect(item(el, 'lists')!.textContent).toBe('Add to lists')
    item(el, 'lists')!.click()
    await flush()
    const picker = document.querySelector('caribou-list-picker')!
    await picker.updateComplete
    expect(picker.shadowRoot!.querySelector('h2')!.textContent).toBe('Lists for @alice@example.social')
    expect(picker.shadowRoot!.querySelector('#hint')).toBeNull()
    expect(read).toHaveBeenCalledWith('42')
  })

  it('Mute shows Muted at once and Unmute takes it back', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    const mute = vi.spyOn(client, 'mute').mockResolvedValue(rel({ muting: true }))
    const unmute = vi.spyOn(client, 'unmute').mockResolvedValue(rel())
    const el = await mountWith(ACCOUNT)
    item(el, 'mute')!.click()
    await el.updateComplete
    expect(badges(el)).toEqual(['Muted'])
    expect(item(el, 'mute')!.textContent).toBe('Unmute @alice@example.social')
    await settle(el)
    expect(mute).toHaveBeenCalledWith({ id: '42' })
    item(el, 'mute')!.click()
    await settle(el)
    expect(unmute).toHaveBeenCalledWith({ id: '42' })
    expect(badges(el)).toEqual([])
  })

  it('a failed mute puts the header back', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel()])
    vi.spyOn(client, 'mute').mockRejectedValue(new Error('boom'))
    const el = await mountWith(ACCOUNT)
    item(el, 'mute')!.click()
    await settle(el)
    await settle(el)
    expect(badges(el)).toEqual([])
    expect(item(el, 'mute')!.textContent).toBe('Mute @alice@example.social')
  })

  it('Block asks first, then shows Blocked and Unblock in place of Follow', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ following: true })])
    const block = vi.spyOn(client, 'block').mockResolvedValue(rel({ blocking: true }))
    const unblock = vi.spyOn(client, 'unblock').mockResolvedValue(rel())
    const el = await mountWith(ACCOUNT)
    item(el, 'block')!.click()
    await settle(el)
    const dialog = document.querySelector('caribou-confirm-dialog')!
    await (dialog as unknown as { updateComplete: Promise<unknown> }).updateComplete
    expect(dialog.shadowRoot!.querySelector('h2')!.textContent).toBe('Block @alice@example.social?')
    dialog.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()
    await settle(el)
    expect(block).toHaveBeenCalledWith({ id: '42' })
    expect(badges(el)).toEqual(['Blocked'])
    expect(button(el)!.dataset.state).toBe('blocked')
    expect(visibleLabel(button(el)!)).toBe('Unblock')
    button(el)!.click()
    await settle(el)
    expect(unblock).toHaveBeenCalledWith({ id: '42' })
    expect(button(el)!.dataset.state).toBe('follow')
  })

  it('Unblock keeps the same button, still focused, now Follow', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ blocking: true })])
    vi.spyOn(client, 'unblock').mockResolvedValue(rel())
    const el = await mountWith(ACCOUNT)
    const before = button(el)!
    expect(before.dataset.state).toBe('blocked')
    before.focus()
    before.click()
    await settle(el)
    expect(button(el)).toBe(before)
    expect(before.dataset.state).toBe('follow')
    expect(el.shadowRoot!.activeElement).toBe(before)
  })
})

// Spec section 11: relationships are read and written only through a client
// on the account's own network.
describe('<caribou-profile-header> across networks', () => {
  const BSKY = {
    ...ACCOUNT, id: 'did:plc:bob', acct: 'bob.example.com',
    bluesky: { did: 'did:plc:bob', handleInvalid: false },
  } as unknown as Account
  const asBluesky = (client: NonNullable<typeof activeClient.value>) => {
    (client as { capabilities: typeof client.capabilities }).capabilities =
      { ...client.capabilities, network: 'bluesky', readLagMs: 60_000 }
  }

  afterEach(() => {
    document.body.replaceChildren()
    activeUserKey.value = null
    users.value = new Map()
    relationshipCache.value = new Map()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('a Mastodon reader on a Bluesky profile: no lookup, no relationship read, no button', async () => {
    const client = signIn()
    const lookup = vi.spyOn(client, 'lookupAccount')
    const fetchRel = vi.spyOn(client, 'fetchRelationships')
    const el = await mountWith(BSKY, '')
    expect(lookup).not.toHaveBeenCalled()
    expect(fetchRel).not.toHaveBeenCalled()
    expect(button(el)).toBeNull()
  })

  it('a Bluesky reader on a Bluesky profile reads by DID, with no server to match', async () => {
    const client = signIn()
    asBluesky(client)
    const lookup = vi.spyOn(client, 'lookupAccount')
    const fetchRel = vi.spyOn(client, 'fetchRelationships').mockResolvedValue([rel({ id: 'did:plc:bob' })])
    const el = await mountWith(BSKY, '')
    expect(lookup).not.toHaveBeenCalled()
    expect(fetchRel).toHaveBeenCalledWith(['did:plc:bob'])
    expect(button(el)?.textContent).toBe('Follow')
  })

  it('a Bluesky reader on a Mastodon profile: no lookup, no relationship read, no button', async () => {
    const client = signIn()
    asBluesky(client)
    const lookup = vi.spyOn(client, 'lookupAccount')
    const fetchRel = vi.spyOn(client, 'fetchRelationships')
    const el = await mountWith(ACCOUNT, 'other.example')
    expect(lookup).not.toHaveBeenCalled()
    expect(fetchRel).not.toHaveBeenCalled()
    expect(button(el)).toBeNull()
  })
})
