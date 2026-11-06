import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type Account, type Capabilities, type Instance, type Status,
} from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, deletedStatusIds, emptyDraft, loadDraft, saveDraft, statusCache,
  unreadNotificationCount, users,
  type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-nav-rail.js'
import '../caribou-compose-dialog.js'
import '../caribou-status-card.js'
import type { CaribouNavRail } from '../caribou-nav-rail.js'
import type { CaribouComposeDialog } from '../caribou-compose-dialog.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'

// A control for a feature the active account's network lacks is hidden,
// not shown broken (`CaribouClient.capabilities`).

// The capabilities each test's client has, by user key. The client is a
// stub: the real Mastodon client with these capabilities in place of its own.
const capsFor = new Map<string, Partial<Capabilities>>()

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) => {
      const client = real.createCaribouClient(...args)
      const caps = capsFor.get(args[0])
      return caps ? { ...client, capabilities: Object.freeze({ ...real.MASTODON_CAPABILITIES, ...caps }) } : client
    },
  }
})

const KEY = 'alice@example.social'
const ME = { id: 'me', username: 'alice', acct: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }

function signIn(caps: Partial<Capabilities> = {}, instance?: Instance) {
  capsFor.set(KEY, caps)
  addUserSession({
    userKey: KEY, server: 'example.social', token: 'TOKEN',
    vapidKey: '', account: ME as unknown as Account, createdAt: 1,
  } as unknown as UserSession)
  const client = activeClient.value!
  if (instance) vi.spyOn(client, 'fetchInstance').mockResolvedValue(instance)
  else vi.spyOn(client, 'fetchInstance').mockRejectedValue(new Error('no instance'))
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
  capsFor.clear()
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

  // The server does not know the account, so it renders every item. The
  // first client render must match it; the items go after mount.
  it('renders every item first, then hides what the network lacks', async () => {
    signIn({ localTimeline: false, publicTimeline: false })
    const el = document.createElement('caribou-nav-rail') as CaribouNavRail
    let first: (string | null)[] | null = null
    el.addController({ hostUpdated: () => { first ??= hrefs(el) } })
    await mount(el)
    expect(first).toEqual(['/home', '/local', '/notifications', '/search', '/public', '/bookmarks', '/lists', '/settings', '/@me'])
    expect(hrefs(el)).not.toContain('/local')
  })

  it('follows a switch to an account on another network', async () => {
    signIn()
    const el = await mount(document.createElement('caribou-nav-rail') as CaribouNavRail)
    expect(hrefs(el)).toContain('/local')
    // A switch makes a new client for the new session.
    capsFor.set('bob@other.example', { localTimeline: false })
    addUserSession({
      userKey: 'bob@other.example', server: 'other.example', token: 'T2',
      vapidKey: '', account: null, createdAt: 2,
    } as unknown as UserSession)
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

  const image = (id: string) => ({ id, type: 'image' as const, url: 'u', previewUrl: null, description: '' })
  const fileInput = (el: CaribouComposeDialog) => $(el, 'input[type="file"]') as HTMLInputElement

  it('takes the character and image limits from the capabilities when the server says nothing', async () => {
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'pic', media: [image('m1')] }))
    const el = await open({ maxChars: 300, maxImages: 2 })
    expect($(el, '.count')!.textContent).toBe('297')
    expect(fileInput(el).disabled).toBe(false)
    document.body.replaceChildren()
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'pic', media: [image('m1'), image('m2')] }))
    const full = await mount(document.createElement('caribou-compose-dialog') as CaribouComposeDialog)
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: {} }))
    await settle(full)
    expect(fileInput(full).disabled).toBe(true)
  })

  // Mastodon has both, so a stored draft with a content warning and a poll
  // is sent whole, also on a retry after a failed post, and kept until then.
  it('keeps a Mastodon draft with a content warning and a poll through a failed post', async () => {
    const poll = { options: ['a', 'b'], expiresIn: 86400, multiple: false, hideTotals: false }
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'q', cw: true, spoilerText: 'spoiler', poll }))
    const el = await open()
    const create = vi.spyOn(activeClient.value!, 'createStatus')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'n1', account: ME } as unknown as Status)
    const post = () => $(el, 'caribou-button.post')!.shadowRoot!.querySelector('button')!.click()
    post()
    await settle(el)
    expect(create).toHaveBeenCalledTimes(1)
    expect(loadDraft(KEY as never, 'new')).toMatchObject({ cw: true, spoilerText: 'spoiler', poll })
    post()
    await settle(el)
    expect(create).toHaveBeenCalledTimes(2)
    for (const [input] of create.mock.calls) {
      expect(input).toMatchObject({ status: 'q', spoilerText: 'spoiler', poll: { options: ['a', 'b'], expiresIn: 86400 } })
    }
    expect(loadDraft(KEY as never, 'new')).toBeNull()
  })

  // Last: a server's limits stay cached for the page's lifetime.
  it('still takes the server\'s own limits over the defaults', async () => {
    signIn({ maxChars: 300 }, {
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
