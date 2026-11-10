import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CaribouError, MASTODON_CAPABILITIES, type CaribouClient, type Capabilities, type Status, type StatusBluesky,
} from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  _testOnlyResetActAs, _testOnlyResetMutations, activeUserKey, blueskyUserKey, cacheStatus, markExpired, saveToStorage,
  setBlueskyDriver, statusCache, users,
  type BlueskyDriver, type BlueskySession, type UserSession,
} from '@beatzball/caribou-state'
import { _testOnlyResetBlueskyVeil, _testOnlyVeilLoaded, setBlueskyReader } from '../_bluesky-moderation.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import '../caribou-status-card.js'
import type { CaribouActAsDialog } from '../caribou-act-as-dialog.js'

// README, "Act as another account (#197)". Each test names the rule it checks.

const ALICE = blueskyUserKey('did:plc:alice')
const BOB = blueskyUserKey('did:plc:bob')
const CAROL = blueskyUserKey('did:plc:carol')
const DAVE = toUserKey('dave', 'example.social')
const FRANK = toUserKey('frank', 'example.social')
const POST = 'at://did:plc:erin/app.bsky.feed.post/3kpost'
const BOB_LIKE = 'at://did:plc:bob/app.bsky.feed.like/3knew'
const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'
const CAPS = { ...MASTODON_CAPABILITIES, network: 'bluesky', readLagMs: 60_000 } as Capabilities

function bsky(name: string, over: Partial<BlueskySession> = {}): BlueskySession {
  return {
    network: 'bluesky', userKey: blueskyUserKey(`did:plc:${name}`), did: `did:plc:${name}`,
    handle: `${name}.example.com`, pds: `https://${name}.pds.example.test`, generation: `G-${name}`,
    account: null, createdAt: 1, ...over,
  }
}

function masto(name: string): UserSession {
  return {
    userKey: toUserKey(name, 'example.social'), server: 'example.social', token: 'T', vapidKey: 'V',
    generation: `M-${name}`, account: { id: name, acct: name, username: name } as never, createdAt: 1,
  }
}

function signIn(active: UserSession, ...others: UserSession[]) {
  users.value = new Map([active, ...others].map((s) => [s.userKey, s]))
  activeUserKey.value = active.userKey
  saveToStorage()
}

function blueskyPost(viewerOf: StatusBluesky['viewerOf'] = ALICE): Status {
  return {
    id: POST, content: '<p>hello</p>', visibility: 'public', createdAt: '2026-11-01T12:00:00Z',
    account: {
      id: 'did:plc:erin', acct: 'erin.example.com', username: 'erin', displayName: 'Erin',
      avatar: '', avatarStatic: '', url: 'https://bsky.app/profile/did:plc:erin', bluesky: { did: 'did:plc:erin', handleInvalid: false },
    },
    favourited: false, favouritesCount: 3, reblogged: false, reblogsCount: 2, bookmarked: false, repliesCount: 1,
    bluesky: {
      uri: POST, cid: 'bafypost', likeUri: null, repostUri: null, replyRef: null,
      replyDisabled: false, embeddingDisabled: false, labels: [],
      moderation: { contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView'].map((c) => [c, { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])), labelersCovered: [BSKY_LABELER] } as unknown as StatusBluesky['moderation'],
      viewerOf,
    },
  } as unknown as Status
}

function mastodonPost(): Status {
  const p = blueskyPost() as unknown as Record<string, unknown>
  delete p.bluesky
  return { ...p, id: '7', account: { id: '42', acct: 'erin', username: 'erin', displayName: 'Erin', avatar: '', avatarStatic: '', url: 'https://example.social/@erin' } } as unknown as Status
}

type Fn = ReturnType<typeof vi.fn>
type Methods = 'fetchStatus' | 'favourite' | 'unfavourite' | 'reblog' | 'bookmark' | 'unbookmark'
interface Made { userKey: string; client: Record<Methods, Fn> }
let made: Made[] = []
let restore: Fn

function clientFor(s: BlueskySession, hooks: { onExpired(): void }): CaribouClient {
  const client: Record<string, unknown> = {
    userKey: s.userKey, capabilities: CAPS, timelineOrder: () => null,
    // The other account's own view: bob has bookmarked the post.
    fetchStatus: vi.fn(async () => ({ ...blueskyPost(s.userKey), bookmarked: true })),
    favourite: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: true, record: BOB_LIKE })),
    unfavourite: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: false, record: null })),
    reblog: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: true, record: 'at://did:plc:bob/app.bsky.feed.repost/3kr' })),
    unbookmark: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: false, record: null })),
    bookmark: vi.fn(async (ref: { id: string }) => ({ ack: true, id: ref.id, on: true, record: null })),
    expire: () => hooks.onExpired(),
  }
  made.push({ userKey: s.userKey, client: client as Record<Methods, Fn> })
  return client as unknown as CaribouClient
}

const onExpired = (e: Event) => {
  const d = (e as CustomEvent<{ userKey: string; generation: string }>).detail
  markExpired(d.userKey as never, d.generation)
}

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  made = []
  restore = vi.fn(async (s: BlueskySession, hooks: { onExpired(): void }) => clientFor(s, hooks))
  setBlueskyDriver({ capabilities: CAPS, timelineOrder: () => null, restore, signOut: vi.fn() } as unknown as BlueskyDriver)
  _testOnlyResetActAs()
  _testOnlyResetMutations()
  _testOnlyResetBlueskyVeil()
  window.addEventListener('caribou:session-expired', onExpired)
  // happy-dom's dialog: enough for show and close.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
})
afterEach(() => {
  window.removeEventListener('caribou:session-expired', onExpired)
  document.body.replaceChildren()
  setBlueskyDriver(null)
  vi.restoreAllMocks()
})

async function settle(el: { updateComplete: Promise<boolean> }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
  }
}

async function mount(status: Status): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.status = status
  document.body.appendChild(el)
  for (let i = 0; i < 3; i++) {
    await settle(el)
    await _testOnlyVeilLoaded()
  }
  await settle(el)
  return el
}

function reader(key: typeof ALICE) {
  setBlueskyReader({
    userKey: key,
    prefs: { adultContentEnabled: false, labels: {}, labelers: [], mutedWords: [], hiddenPosts: [] },
    labelDefs: { [BSKY_LABELER]: [] },
  })
}

const item = (el: CaribouStatusCard) => el.shadowRoot!.querySelector<HTMLButtonElement>('caribou-menu.more [data-action="act-as"]')
const menuItems = (el: CaribouStatusCard) =>
  [...el.shadowRoot!.querySelectorAll('caribou-menu.more .menu-item')].map((b) => b.getAttribute('data-action'))
const dialog = () => document.querySelector('caribou-act-as-dialog') as CaribouActAsDialog | null
const inDialog = <T extends Element = HTMLElement>(sel: string) => dialog()!.shadowRoot!.querySelector<T>(sel)
const actionButton = (cls: string) => inDialog(`.actions caribou-icon-button.${cls}`) as HTMLElement & { label: string; pressed: boolean; softDisabled: boolean }
const cardPressed = (el: CaribouStatusCard, cls: string) =>
  el.shadowRoot!.querySelector(`.actions caribou-icon-button.${cls}`)!.getAttribute('pressed')

async function openDialog(el: CaribouStatusCard): Promise<void> {
  item(el)!.click()
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  await settle(dialog()!)
}

describe('rule 1: the menu item shows only with an account to pick', () => {
  it('a Bluesky reader with another Bluesky account sees "Act as another account…" in More', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    expect(menuItems(el)).toEqual(['mute', 'block', 'act-as'])
    expect(item(el)!.textContent).toBe('Act as another account…')
  })

  it('with only one Bluesky account, More is as it was', async () => {
    signIn(bsky('alice'), masto('dave'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    expect(menuItems(el)).toEqual(['mute', 'block'])
  })

  it('a Mastodon post shows no item, even with two Mastodon accounts (#131 is open)', async () => {
    signIn(masto('dave'), masto('frank'), bsky('bob'))
    const el = await mount(mastodonPost())
    expect(menuItems(el)).toEqual(['mute', 'block'])
    expect(users.value.has(FRANK) && activeUserKey.value === DAVE).toBe(true)
  })

  it('a Mastodon reader gets a More menu with only the item on a Bluesky post', async () => {
    signIn(masto('dave'), bsky('bob'))
    const el = await mount(blueskyPost(null))
    expect(menuItems(el)).toEqual(['act-as'])
    // The card's own buttons stay off for the Mastodon reader.
    const fav = el.shadowRoot!.querySelector('.actions caribou-icon-button.favourite')!
    expect(fav.hasAttribute('soft-disabled')).toBe(true)
  })

  it('signed out: no menu', async () => {
    const el = await mount(blueskyPost(null))
    expect(el.shadowRoot!.querySelector('caribou-menu.more')).toBeNull()
  })
})

describe('rules 2 and 3: the picker and which account acts', () => {
  it('lists only the other Bluesky accounts; an expired one says so and is not read', async () => {
    signIn(bsky('alice'), bsky('bob'), masto('dave'), bsky('carol', { expired: true }))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    const rows = [...dialog()!.shadowRoot!.querySelectorAll('li.account')].map((li) => li.getAttribute('data-user-key'))
    expect(rows).toEqual([BOB, CAROL])
    const carol = dialog()!.shadowRoot!.querySelector(`li[data-user-key="${CAROL}"]`)!
    expect(carol.textContent).toContain('Signed out. Sign in again to use it.')
    ;(carol.querySelector('caribou-button') as HTMLElement).click()
    await settle(dialog()!)
    expect(inDialog('[role="alert"]')!.textContent).toBe('@carol.example.com is signed out. Sign in again to use it.')
    expect(inDialog('.actions')).toBeNull()
    expect(restore).not.toHaveBeenCalled()
  })

  it('with one account, it is picked and read at once; the buttons show its own view and name it', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    expect(made.map((m) => m.userKey)).toEqual([BOB])
    expect(made[0]!.client.fetchStatus).toHaveBeenCalledWith(POST)
    expect(actionButton('favourite').label).toBe('Favourite as @bob.example.com')
    expect(actionButton('favourite').pressed).toBe(false)
    expect(actionButton('bookmark').label).toBe('Remove bookmark as @bob.example.com')
    expect(actionButton('bookmark').pressed).toBe(true)
  })
})

describe('rule 4: the card does not change', () => {
  it('a favourite as bob is sent by bob client; the card stays unfavourited with its count', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    // The reader's own copy is cached, so "unchanged" means something.
    cacheStatus(blueskyPost())
    const before = statusCache.value.get(POST)
    expect(before).toBeDefined()
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    expect(made[0]!.client.favourite).toHaveBeenCalledTimes(1)
    expect(made[0]!.client.favourite.mock.calls[0]![0]).toEqual({
      id: POST, bluesky: { uri: POST, cid: 'bafypost', likeUri: null, repostUri: null },
    })
    expect(actionButton('favourite').pressed).toBe(true)
    expect(inDialog('[role="status"]')!.textContent).toBe('Favourited as @bob.example.com.')
    await settle(el)
    expect(statusCache.value.get(POST)).toBe(before)
    expect(cardPressed(el, 'favourite')).toBe('false')
    expect(el.shadowRoot!.querySelector('.actions caribou-icon-button.favourite')!.getAttribute('count')).toBe('3')
  })

  it('an undo uses bob own record', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    expect(made[0]!.client.unfavourite.mock.calls[0]![0]).toMatchObject({ bluesky: { likeUri: BOB_LIKE } })
    expect(inDialog('[role="status"]')!.textContent).toBe('Unfavourited as @bob.example.com.')
  })
})

describe('rule 5: every answer is shown as it is', () => {
  it('a failure says so and the button keeps its old state', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    made[0]!.client.reblog.mockRejectedValueOnce(new CaribouError('unreachable', 'offline'))
    actionButton('reblog').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    expect(inDialog('[role="alert"]')!.textContent).toBe('Could not boost this post as @bob.example.com. Try again.')
    expect(actionButton('reblog').pressed).toBe(false)
    expect(inDialog('[role="status"]')!.textContent).toBe('')
  })

  it('a write in flight soft-disables its button; a second click sends nothing', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    let release!: () => void
    made[0]!.client.favourite.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ ack: true, id: POST, on: true, record: BOB_LIKE })
    }))
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    expect(actionButton('favourite').softDisabled).toBe(true)
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    release()
    await settle(dialog()!)
    expect(made[0]!.client.favourite).toHaveBeenCalledTimes(1)
    expect(actionButton('favourite').pressed).toBe(true)
  })

  it('a gone session says bob is signed out and writes nothing more', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    made[0]!.client.favourite.mockImplementationOnce(async () => {
      ;(made[0]!.client as unknown as { expire(): void }).expire()
      throw new CaribouError('unauthorized', 'gone')
    })
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    expect(inDialog('[role="alert"]')!.textContent).toBe('@bob.example.com is signed out. Sign in again to use it.')
    expect(inDialog('.actions')).toBeNull()
    expect(users.value.get(BOB)!.expired).toBe(true)
    expect(users.value.get(ALICE)!.expired).toBeUndefined()
  })
})

describe('rule 6: the dialog closes when the active account changes', () => {
  it('a switch closes it; an answer after that changes nothing', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    cacheStatus(blueskyPost())
    await openDialog(el)
    let release!: () => void
    made[0]!.client.favourite.mockImplementationOnce(() => new Promise((r) => {
      release = () => r({ ack: true, id: POST, on: true, record: BOB_LIKE })
    }))
    actionButton('favourite').shadowRoot!.querySelector('button')!.click()
    await settle(dialog()!)
    const d = dialog()!
    activeUserKey.value = BOB
    await vi.waitFor(() => expect(dialog()).toBeNull())
    release()
    await settle(d)
    expect(d.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('')
    // The switch drops the old reader's viewer fields; none is bob's like.
    const after = statusCache.value.get(POST)
    expect(after).toBeDefined()
    expect(after!.favourited).not.toBe(true)
    expect(after!.bluesky!.likeUri ?? null).toBeNull()
  })
})

const click = (cls: string) => actionButton(cls).shadowRoot!.querySelector('button')!.click()

// A gate: the call waits until `open()`.
function held<T>(value: T) {
  let open!: () => void
  const promise = new Promise<T>((r) => { open = () => r(value) })
  return { promise, open: () => open() }
}

describe('rule 5: an expired account stays signed out, whatever lands after', () => {
  async function twoActions() {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    const fav = held({ ack: true, id: POST, on: true, record: BOB_LIKE })
    made[0]!.client.favourite.mockImplementationOnce(() => fav.promise)
    // Bob has bookmarked the post, so the bookmark click is an unbookmark.
    // It answers 401 when `mark` opens.
    const mark = held(null)
    made[0]!.client.unbookmark.mockImplementationOnce(async () => {
      await mark.promise
      ;(made[0]!.client as unknown as { expire(): void }).expire()
      throw new CaribouError('unauthorized', 'gone')
    })
    click('favourite')
    click('bookmark')
    await settle(dialog()!)
    return { fav, mark }
  }

  const signedOut = () => {
    expect(inDialog('[role="alert"]')!.textContent).toBe('@bob.example.com is signed out. Sign in again to use it.')
    expect(inDialog('.actions')).toBeNull()
    expect(inDialog('[role="status"]')!.textContent).toBe('')
  }

  it('401 first, then the other ack: still signed out', async () => {
    const { fav, mark } = await twoActions()
    mark.open()
    await settle(dialog()!)
    signedOut()
    fav.open()
    await settle(dialog()!)
    signedOut()
  })

  it('the ack first, then 401: signed out', async () => {
    const { fav, mark } = await twoActions()
    fav.open()
    await settle(dialog()!)
    expect(actionButton('favourite').pressed).toBe(true)
    mark.open()
    await settle(dialog()!)
    signedOut()
  })

  it('a read that lands after expiry shows signed out, not the buttons', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    const read = held({ ...blueskyPost(BOB) })
    restore.mockImplementationOnce(async (s: BlueskySession, hooks: { onExpired(): void }) => {
      const c = clientFor(s, hooks) as unknown as Record<string, Fn>
      c.fetchStatus!.mockImplementationOnce(() => read.promise)
      return c as unknown as CaribouClient
    })
    await openDialog(el)
    markExpired(BOB, 'G-bob')
    read.open()
    await settle(dialog()!)
    signedOut()
  })
})

describe('rule 3: a reopened dialog keeps the acked like while reads lag', () => {
  it('like, close, reopen with a stale read: Unfavourite; its click deletes the acked like; no second like', async () => {
    signIn(bsky('alice'), bsky('bob'))
    reader(ALICE)
    const el = await mount(blueskyPost())
    await openDialog(el)
    // The AppView lags: every read shows the post as before the like.
    made[0]!.client.fetchStatus.mockImplementation(async () => blueskyPost(BOB))
    click('favourite')
    await settle(dialog()!)
    inDialog<HTMLElement>('caribou-button.done')!.click()
    await vi.waitFor(() => expect(dialog()).toBeNull())
    await openDialog(el)
    expect(made[0]!.client.fetchStatus).toHaveBeenCalledTimes(2)
    expect(actionButton('favourite').label).toBe('Unfavourite as @bob.example.com')
    // Picking the account again reads again; the like still holds.
    ;(inDialog(`li[data-user-key="${BOB}"] caribou-button`) as HTMLElement).click()
    await settle(dialog()!)
    expect(actionButton('favourite').pressed).toBe(true)
    click('favourite')
    await settle(dialog()!)
    expect(made[0]!.client.favourite).toHaveBeenCalledTimes(1)
    expect(made[0]!.client.unfavourite.mock.calls[0]![0]).toMatchObject({ bluesky: { likeUri: BOB_LIKE } })
  })
})

describe('rule 1: menu names and the own post', () => {
  it('the More menu with only the item has the same name as the full one', async () => {
    signIn(masto('dave'), bsky('bob'))
    const el = await mount(blueskyPost(null))
    expect(el.shadowRoot!.querySelector('caribou-menu.more')!.getAttribute('label')).toBe('More actions for post by @erin.example.com')
  })

  it('the reader own post, before the account loads, still offers the item', async () => {
    signIn(bsky('erin'), bsky('bob'))
    reader(blueskyUserKey('did:plc:erin'))
    const el = await mount(blueskyPost(blueskyUserKey('did:plc:erin')))
    expect(menuItems(el)).toEqual(['act-as'])
  })
})
