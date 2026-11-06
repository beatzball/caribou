import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MASTODON_CAPABILITIES,
  type Account, type Capabilities, type Instance, type Status,
} from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, deletedStatusIds, statusCache, unreadNotificationCount, users,
  type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-nav-rail.js'
import '../caribou-compose-dialog.js'
import '../caribou-status-card.js'
import type { CaribouNavRail } from '../caribou-nav-rail.js'
import type { CaribouComposeDialog } from '../caribou-compose-dialog.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

// A control for a feature the active account's network lacks is hidden,
// not shown broken (`CaribouClient.capabilities`).

const ME = { id: 'me', username: 'alice', acct: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

function signIn(caps: Partial<Capabilities> = {}) {
  addUserSession({
    userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
    vapidKey: '', account: ME as unknown as Account, createdAt: 1,
  } as unknown as UserSession)
  const client = activeClient.value!
  client.capabilities = { ...MASTODON_CAPABILITIES, ...caps }
  vi.spyOn(client, 'fetchInstance').mockRejectedValue(new Error('no instance'))
  return client
}

async function settle(el: HTMLElement & { updateComplete: Promise<boolean> }) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* wait */ }
  }
}

async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(el: T): Promise<T> {
  document.body.appendChild(el)
  await settle(el)
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)

beforeEach(() => {
  localStorage.clear()
  users.value = new Map()
  activeUserKey.value = null
  statusCache.value = new Map()
  deletedStatusIds.value = new Set()
  unreadNotificationCount.value = 0
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})

afterEach(() => {
  document.body.replaceChildren()
  activeUserKey.value = null
  users.value = new Map()
  vi.restoreAllMocks()
})

describe('nav rail', () => {
  const hrefs = (el: Element) => [...el.shadowRoot!.querySelectorAll('nav > a')].map((a) => a.getAttribute('href'))
  const moreHrefs = (el: Element) =>
    [...el.shadowRoot!.querySelectorAll('caribou-menu.more > a')].map((a) => a.getAttribute('href'))

  it('shows Local and Public for Mastodon', async () => {
    signIn()
    const el = await mount(document.createElement('caribou-nav-rail') as CaribouNavRail)
    expect(hrefs(el)).toContain('/local')
    expect(hrefs(el)).toContain('/public')
    expect(moreHrefs(el)).toContain('/public')
  })

  it('hides Local and Public when the network has neither', async () => {
    signIn({ localTimeline: false, publicTimeline: false })
    const el = await mount(document.createElement('caribou-nav-rail') as CaribouNavRail)
    expect(hrefs(el)).not.toContain('/local')
    expect(hrefs(el)).not.toContain('/public')
    expect(moreHrefs(el)).not.toContain('/public')
    expect(hrefs(el)).toContain('/home')
  })

  it('shows every item when no account is signed in', async () => {
    const el = await mount(document.createElement('caribou-nav-rail') as CaribouNavRail)
    expect(hrefs(el)).toContain('/local')
    expect(hrefs(el)).toContain('/public')
  })

  it('follows a switch to an account on another network', async () => {
    signIn()
    const el = await mount(document.createElement('caribou-nav-rail') as CaribouNavRail)
    expect(hrefs(el)).toContain('/local')
    // A new client for a new session, as a switch makes.
    addUserSession({
      userKey: 'bob@other.example', server: 'other.example', token: 'T2',
      vapidKey: '', account: null, createdAt: 2,
    } as unknown as UserSession)
    activeClient.value!.capabilities = { ...MASTODON_CAPABILITIES, localTimeline: false }
    // The edit above is not a signal change; another signal the rail's
    // effect reads runs it again with the edited client.
    unreadNotificationCount.value = 1
    await settle(el)
    expect(hrefs(el)).not.toContain('/local')
  })
})

describe('compose dialog', () => {
  async function open(caps: Partial<Capabilities> = {}) {
    signIn(caps)
    const el = await mount(document.createElement('caribou-compose-dialog') as CaribouComposeDialog)
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: {} }))
    await settle(el)
    return el
  }

  it('shows visibility, content warning and poll for Mastodon', async () => {
    const el = await open()
    expect($(el, '#compose-visibility')).not.toBeNull()
    expect($(el, '[data-action="toggle-cw"]')).not.toBeNull()
    expect($(el, '[data-action="toggle-poll"]')).not.toBeNull()
  })

  it('hides visibility, content warning and poll when the network has none', async () => {
    const el = await open({ visibility: false, contentWarningText: false, polls: false })
    expect($(el, '#compose-visibility')).toBeNull()
    expect($(el, '[data-action="toggle-cw"]')).toBeNull()
    expect($(el, '[data-action="toggle-poll"]')).toBeNull()
    expect($(el, '#compose-cw')).toBeNull()
    expect($(el, '[data-action="add-media"]')).not.toBeNull()
  })

  it('takes the character and image limits from the capabilities when the server says nothing', async () => {
    const el = await open({ maxChars: 300, maxImages: 2 })
    expect($(el, '.count')!.textContent).toBe('300')
  })

  it('still takes the server\'s own limits over the defaults', async () => {
    signIn({ maxChars: 300 })
    vi.mocked(activeClient.value!.fetchInstance).mockResolvedValue({
      configuration: { statuses: { maxCharacters: 1000, maxMediaAttachments: 4 }, mediaAttachments: {}, polls: {} },
    } as unknown as Instance)
    const el = await mount(document.createElement('caribou-compose-dialog') as CaribouComposeDialog)
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: {} }))
    await settle(el)
    expect($(el, '.count')!.textContent).toBe('1000')
  })
})

describe('status card', () => {
  const post = (over: Record<string, unknown> = {}) => ({
    id: '1', content: '<p>hi</p>', createdAt: '2026-04-28T12:00:00Z', visibility: 'public', spoilerText: '',
    sensitive: false, language: 'en', inReplyToId: null, editedAt: null, mediaAttachments: [],
    favourited: false, reblogged: false, bookmarked: false,
    favouritesCount: 0, reblogsCount: 0, repliesCount: 0,
    account: ME, ...over,
  }) as unknown as Status

  async function card(status: Status) {
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.instance = 'example.social'
    el.status = status
    return mount(el)
  }

  it('offers Edit and the edit history for Mastodon', async () => {
    signIn()
    const el = await card(post({ editedAt: '2026-04-28T13:00:00Z' }))
    expect($(el, 'caribou-menu.more button[data-action="edit"]')).not.toBeNull()
    expect($(el, 'caribou-button[data-action="history"]')).not.toBeNull()
  })

  it('hides Edit and the history button when the network cannot edit', async () => {
    signIn({ edit: false })
    const el = await card(post({ editedAt: '2026-04-28T13:00:00Z' }))
    expect($(el, 'caribou-menu.more button[data-action="edit"]')).toBeNull()
    expect($(el, 'caribou-menu.more button[data-action="delete"]')).not.toBeNull()
    expect($(el, 'caribou-button[data-action="history"]')).toBeNull()
    expect($(el, 'span.edited')).not.toBeNull()
  })
})
