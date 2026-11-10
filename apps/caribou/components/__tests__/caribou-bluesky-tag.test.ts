import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import type { Capabilities, CaribouClient, TimelinePage } from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, addUserSession, blueskyUserKey, setBlueskyDriver, users, type BlueskyDriver, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-bluesky-tag.js'
import type { CaribouBlueskyTag } from '../caribou-bluesky-tag.js'

// The body of `/tags/<tag>?net=bsky` (README, "Bluesky search and hashtag
// page"): the sign-in notice until a Bluesky account is active, then the
// tag's posts from the reader's client.

// A Mastodon account's client that never reaches the network (#251 review).
vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  return {
    ...real,
    createCaribouClient: (userKey: string) => new Proxy({ userKey, capabilities: real.MASTODON_CAPABILITIES, timelineOrder: () => null }, {
      get: (target, prop) => prop in target ? target[prop as keyof typeof target]
        : () => Promise.reject(new real.CaribouError('unreachable', 'test: no network')),
    }),
  }
})

const CAPS = { network: 'bluesky', readLagMs: 60_000, followTags: false } as unknown as Capabilities
const alice = blueskyUserKey('did:plc:alice')
const fetchTimeline = vi.fn<(kind: unknown, params?: unknown) => Promise<TimelinePage>>()

const driver: BlueskyDriver = {
  capabilities: CAPS,
  timelineOrder: () => null,
  restore: async (s) => ({
    userKey: s.userKey, capabilities: CAPS, timelineOrder: () => null, fetchTimeline,
  }) as unknown as CaribouClient,
  signOut: async () => {},
}

function signInBluesky() {
  const s: UserSession = {
    network: 'bluesky', userKey: alice, did: 'did:plc:alice', handle: 'alice.example.com',
    pds: 'https://pds.example.test', generation: 'G1', account: null, createdAt: 1,
  }
  users.value = new Map([[alice, s]])
  activeUserKey.value = alice
}

function signInMastodon() {
  addUserSession({
    userKey: 'me@example.social', server: 'example.social', token: 'TOKEN', vapidKey: '',
    account: { id: '1', acct: 'me' }, createdAt: 1,
  } as unknown as UserSession)
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function mount(tag = 'Cats'): Promise<CaribouBlueskyTag> {
  const el = document.createElement('caribou-bluesky-tag') as CaribouBlueskyTag
  el.tag = tag
  document.body.appendChild(el)
  for (let i = 0; i < 3; i++) {
    await flush()
    await el.updateComplete
  }
  return el
}

const notice = (el: CaribouBlueskyTag) => el.shadowRoot!.querySelector('.notice')
const timeline = (el: CaribouBlueskyTag) => el.shadowRoot!.querySelector('caribou-timeline')

beforeEach(() => {
  setBlueskyDriver(driver)
  fetchTimeline.mockReset()
  fetchTimeline.mockResolvedValue(Object.assign([], { nextCursor: null }))
  localStorage.clear()
})

afterEach(() => {
  document.body.replaceChildren()
  setBlueskyDriver(null)
  users.value = new Map()
  activeUserKey.value = null
})

describe('<caribou-bluesky-tag>', () => {
  // The server has no session: it and the first client render show the
  // notice (the reader is read in firstUpdated).
  it('renders the heading and the sign-in notice with a bsky.app link', async () => {
    const el = document.createElement('caribou-bluesky-tag') as CaribouBlueskyTag
    el.tag = 'Cats & Dogs'
    document.body.appendChild(el)
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('caribou-tag-header')!.getAttribute('name')).toBe('Cats & Dogs')
    expect(notice(el)!.textContent!.replace(/\s+/g, ' ')).toContain('Sign in with Bluesky to see posts with this tag.')
    const link = notice(el)!.querySelector<HTMLAnchorElement>('a.outside')!
    expect(link.getAttribute('href')).toBe('https://bsky.app/hashtag/Cats%20%26%20Dogs')
    expect(link.textContent!.trim()).toBe('See #Cats & Dogs on Bluesky')
    expect(timeline(el)).toBeNull()
  })

  // The hydration rule: with a Bluesky account active, the first client
  // render still equals the server's notice; the timeline comes after.
  it('first renders the notice even with a Bluesky account active', async () => {
    signInBluesky()
    const el = document.createElement('caribou-bluesky-tag') as CaribouBlueskyTag
    el.tag = 'Cats'
    let first: { notice: boolean; timeline: boolean } | null = null
    const firstUpdated = (el as unknown as { firstUpdated: () => void }).firstUpdated.bind(el)
    ;(el as unknown as { firstUpdated: () => void }).firstUpdated = () => {
      first = { notice: notice(el) !== null, timeline: timeline(el) !== null }
      firstUpdated()
    }
    document.body.appendChild(el)
    await el.updateComplete
    expect(first).toEqual({ notice: true, timeline: false })
    await vi.waitFor(() => expect(timeline(el)).not.toBeNull())
  })

  // #251 review: with a Mastodon account active, `/` forwards to Home. The
  // add-account page is where a reader signs in with Bluesky.
  it('sends Sign in to the add-account page, also with a Mastodon account active', async () => {
    signInMastodon()
    const el = await mount()
    const signIn = notice(el)!.querySelector('litro-link')!
    expect(signIn.getAttribute('href')).toBe('/?add')
    const { rootForwardTarget } = await import('../_root-forward.js')
    // `/` itself would forward this reader to Home.
    expect(rootForwardTarget('', localStorage, sessionStorage)).not.toBeNull()
    expect(rootForwardTarget(new URL(signIn.getAttribute('href')!, 'https://caribou.test').search, localStorage, sessionStorage)).toBeNull()
  })

  it('keeps the notice signed out and with a Mastodon account', async () => {
    let el = await mount()
    expect(notice(el)).not.toBeNull()
    expect(timeline(el)).toBeNull()
    el.remove()
    signInMastodon()
    el = await mount()
    expect(notice(el)).not.toBeNull()
    expect(timeline(el)).toBeNull()
    expect(fetchTimeline).not.toHaveBeenCalled()
  })

  it('shows the tag timeline from the Bluesky client after mount', async () => {
    signInBluesky()
    const el = await mount()
    expect(notice(el)).toBeNull()
    const t = timeline(el)!
    expect(t.getAttribute('kind')).toBe('hashtag')
    expect(t.getAttribute('net')).toBe('bsky')
    expect(t.getAttribute('tag')).toBe('Cats')
    await vi.waitFor(() => expect(fetchTimeline.mock.calls[0]?.[0]).toEqual({ type: 'hashtag', tag: 'Cats' }))
  })

  it('swaps back to the notice when the reader switches to a Mastodon account', async () => {
    signInBluesky()
    const el = await mount()
    expect(timeline(el)).not.toBeNull()
    signInMastodon()
    await flush()
    await el.updateComplete
    expect(timeline(el)).toBeNull()
    expect(notice(el)).not.toBeNull()
  })
})
