import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { toUserKey } from '@beatzball/caribou-auth'
import { CaribouError, type AccountPage, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, relationshipCache, users,
} from '@beatzball/caribou-state'
import '../caribou-moderation-settings.js'
import type { CaribouModerationSettings } from '../caribou-moderation-settings.js'

const account = (id: string, acct: string) =>
  ({ id, acct, username: acct, displayName: acct.toUpperCase(), avatar: '', avatarStatic: '' }) as mastodon.v1.Account

const page = (items: mastodon.v1.Account[], nextMaxId: string | null = null): AccountPage =>
  Object.assign(items, { nextMaxId })

const FILTER = {
  id: 'f1', title: 'Spoilers', context: ['home', 'thread'], filterAction: 'warn', expiresAt: null,
  keywords: [{ id: 'k1', keyword: 'finale', wholeWord: true }, { id: 'k2', keyword: 'ending', wholeWord: false }],
  statuses: [],
} as unknown as mastodon.v2.Filter

function signIn(): CaribouClient {
  addUserSession({
    userKey: toUserKey('alice', 'example.social'), server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as mastodon.v1.Account,
  })
  return activeClient.value!
}

function stub(client: CaribouClient, over: {
  filters?: () => Promise<mastodon.v2.Filter[]>
  mutes?: (p?: { maxId?: string }) => Promise<AccountPage>
  blocks?: (p?: { maxId?: string }) => Promise<AccountPage>
} = {}) {
  return {
    filters: vi.spyOn(client, 'fetchFilters').mockImplementation(over.filters ?? (async () => [FILTER])),
    mutes: vi.spyOn(client, 'fetchMutes').mockImplementation(over.mutes ?? (async () => page([account('7', 'bob')]))),
    blocks: vi.spyOn(client, 'fetchBlocks').mockImplementation(over.blocks ?? (async () => page([account('8', 'carol@other.example')]))),
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function mount(): Promise<CaribouModerationSettings> {
  const el = document.createElement('caribou-moderation-settings')
  document.body.appendChild(el)
  await el.updateComplete
  await flush()
  await el.updateComplete
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const section = (el: Element, id: string) => $(el, `section[aria-labelledby="${id}"]`)!

beforeEach(() => {
  document.body.replaceChildren()
  users.value = new Map()
  activeUserKey.value = null
  relationshipCache.value = new Map()
  localStorage.clear()
})
afterEach(() => { vi.restoreAllMocks() })

describe('<caribou-moderation-settings>', () => {
  it('lists the filters, read only, with a link to edit them on the server', async () => {
    stub(signIn())
    const el = await mount()
    const filters = section(el, 'filters-h')
    expect(filters.querySelector('h2')!.textContent).toBe('Filters')
    const row = filters.querySelector('li.filter')!
    expect(row.querySelector('h3')!.textContent).toBe('Spoilers')
    expect(row.querySelector('.meta')!.textContent).toBe('Warn · Home and lists, Conversations')
    expect(row.textContent).toContain('Words: finale, ending')
    expect(filters.querySelector('button, caribou-button')).toBeNull()
    const edit = filters.querySelector('a')!
    expect(edit.getAttribute('href')).toBe('https://example.social/filters')
    expect(edit.textContent).toBe('Edit filters on example.social')
  })

  it('says so on a server without filters v2', async () => {
    stub(signIn(), { filters: async () => { throw new CaribouError('not_found', 'nope') } })
    const el = await mount()
    expect(section(el, 'filters-h').querySelector('.notice')!.textContent).toBe('Your server does not list filters to apps.')
  })

  it('lists muted and blocked accounts with links to their profiles', async () => {
    stub(signIn())
    const el = await mount()
    const muted = section(el, 'mutes-h').querySelector('li.account')!
    expect(muted.querySelector('a.who')!.getAttribute('href')).toBe('/@bob@example.social')
    expect(muted.querySelector('caribou-button')!.textContent).toBe('Unmute @bob')
    const blocked = section(el, 'blocks-h').querySelector('li.account')!
    expect(blocked.querySelector('a.who')!.getAttribute('href')).toBe('/@carol@other.example')
    expect(blocked.querySelector('caribou-button')!.textContent).toBe('Unblock @carol@other.example')
  })

  it('Unmute keeps the row with a Mute button; a click again mutes again', async () => {
    const client = signIn()
    stub(client)
    const unmute = vi.spyOn(client, 'unmute').mockResolvedValue({ id: '7', muting: false } as mastodon.v1.Relationship)
    const mute = vi.spyOn(client, 'mute').mockResolvedValue({ id: '7', muting: true } as mastodon.v1.Relationship)
    const el = await mount()
    const button = () => section(el, 'mutes-h').querySelector<HTMLElement>('li.account caribou-button')!
    button().click()
    await el.updateComplete
    expect(button().textContent).toBe('Mute @bob')
    await flush()
    expect(unmute).toHaveBeenCalledWith('7')
    button().click()
    await flush()
    await el.updateComplete
    expect(mute).toHaveBeenCalledWith('7')
    expect(button().textContent).toBe('Unmute @bob')
  })

  it('Unblock calls the server and turns the button to Block', async () => {
    const client = signIn()
    stub(client)
    const unblock = vi.spyOn(client, 'unblock').mockResolvedValue({ id: '8', blocking: false } as mastodon.v1.Relationship)
    const el = await mount()
    section(el, 'blocks-h').querySelector<HTMLElement>('li.account caribou-button')!.click()
    await flush()
    await el.updateComplete
    expect(unblock).toHaveBeenCalledWith('8')
    expect(section(el, 'blocks-h').querySelector('li.account caribou-button')!.textContent).toBe('Block @carol@other.example')
  })

  it('Block again after Unblock asks first, and Cancel sends nothing', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const client = signIn()
    stub(client)
    vi.spyOn(client, 'unblock').mockResolvedValue({ id: '8', blocking: false } as mastodon.v1.Relationship)
    const block = vi.spyOn(client, 'block').mockResolvedValue({ id: '8', blocking: true } as mastodon.v1.Relationship)
    const el = await mount()
    const button = () => section(el, 'blocks-h').querySelector<HTMLElement>('li.account caribou-button')!
    button().click()
    await flush()
    await el.updateComplete
    button().click()
    await flush()
    const dialog = document.querySelector('caribou-confirm-dialog')!
    expect(dialog).not.toBeNull()
    await (dialog as unknown as { updateComplete: Promise<unknown> }).updateComplete
    dialog.shadowRoot!.querySelector<HTMLElement>('caribou-button.cancel')!.click()
    await flush()
    expect(block).not.toHaveBeenCalled()
    button().click()
    await flush()
    const again = document.querySelector('caribou-confirm-dialog')!
    await (again as unknown as { updateComplete: Promise<unknown> }).updateComplete
    again.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()
    await flush()
    await el.updateComplete
    expect(block).toHaveBeenCalledWith('8')
    expect(button().textContent).toBe('Unblock @carol@other.example')
  })

  it('marks an expired filter', async () => {
    stub(signIn(), { filters: async () => [{ ...FILTER, expiresAt: '2020-01-01T00:00:00Z' }] })
    const el = await mount()
    expect(section(el, 'filters-h').querySelector('.meta')!.textContent).toBe('Expired · Warn · Home and lists, Conversations')
  })

  it('loads more by the cursor', async () => {
    const client = signIn()
    const s = stub(client, {
      mutes: async (p) => p?.maxId === '300' ? page([account('5', 'dave')]) : page([account('7', 'bob')], '300'),
    })
    const el = await mount()
    const more = section(el, 'mutes-h').querySelector<HTMLElement>('.more caribou-button')!
    expect(more.textContent).toBe('Load more')
    more.click()
    await flush()
    await el.updateComplete
    expect(s.mutes).toHaveBeenLastCalledWith({ maxId: '300' })
    expect([...section(el, 'mutes-h').querySelectorAll('li.account')].map((li) => li.getAttribute('data-account-id')))
      .toEqual(['7', '5'])
    expect(section(el, 'mutes-h').querySelector('.more')).toBeNull()
  })

  it('empty lists say so', async () => {
    stub(signIn(), { mutes: async () => page([]), blocks: async () => page([]), filters: async () => [] })
    const el = await mount()
    expect(section(el, 'filters-h').querySelector('.notice')!.textContent).toBe('You have no filters.')
    expect(section(el, 'mutes-h').querySelector('.notice')!.textContent).toBe('You have not muted anyone.')
    expect(section(el, 'blocks-h').querySelector('.notice')!.textContent).toBe('You have not blocked anyone.')
  })

  it('a failed list shows an alert with Retry', async () => {
    let fail = true
    stub(signIn(), { blocks: async () => { if (fail) throw new Error('boom'); return page([account('8', 'carol')]) } })
    const el = await mount()
    const blocks = section(el, 'blocks-h')
    expect(blocks.querySelector('[role="alert"]')!.textContent).toContain('Could not load the list.')
    fail = false
    blocks.querySelector<HTMLElement>('caribou-button[data-action="retry"]')!.click()
    await flush()
    await el.updateComplete
    expect(section(el, 'blocks-h').querySelector('[role="alert"]')).toBeNull()
    expect(section(el, 'blocks-h').querySelector('li.account')).not.toBeNull()
  })
})
