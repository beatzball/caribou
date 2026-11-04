import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import {
  activeClient, activeUserKey, addUserSession, emptyDraft, loadDraft, saveDraft, statusCache, users,
  type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-compose-dialog.js'
import type { CaribouComposeDialog } from '../caribou-compose-dialog.js'

const ME = { id: 'a1', username: 'alice', acct: 'alice', displayName: 'Alice' }
const KEY = 'alice@example.social'

function signIn(account: object = ME, userKey = KEY): NonNullable<typeof activeClient.value> {
  addUserSession({
    userKey, server: 'example.social', token: 'TOKEN',
    vapidKey: '', account, createdAt: 1,
  } as unknown as UserSession)
  const client = activeClient.value!
  vi.spyOn(client, 'fetchInstance').mockResolvedValue({
    configuration: { statuses: { maxCharacters: 100, maxMediaAttachments: 2 }, mediaAttachments: {},
      polls: { maxOptions: 3, maxCharactersPerOption: 25, minExpiration: 300, maxExpiration: 86400 } },
  } as unknown as mastodon.v2.Instance)
  return client
}

async function settle(el: CaribouComposeDialog) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* wait */ }
  }
}

async function mount(): Promise<CaribouComposeDialog> {
  const el = document.createElement('caribou-compose-dialog')
  document.body.appendChild(el)
  await settle(el)
  return el
}

function $<T extends Element = HTMLElement>(el: CaribouComposeDialog, sel: string): T | null {
  return el.shadowRoot!.querySelector<T>(sel)
}

async function type(el: CaribouComposeDialog, text: string) {
  const ta = $<HTMLTextAreaElement>(el, 'textarea')!
  ta.value = text
  ta.dispatchEvent(new Event('input'))
  await settle(el)
}

// The real <button> inside a shared control's shadow root.
function inner(host: Element): HTMLButtonElement {
  return host.shadowRoot!.querySelector('button')!
}

function postButton(el: CaribouComposeDialog) {
  return inner($(el, 'caribou-button.post')!)
}

async function compose(el: CaribouComposeDialog, inReplyTo?: mastodon.v1.Status) {
  window.dispatchEvent(new CustomEvent('caribou:compose', { detail: inReplyTo ? { inReplyTo } : {} }))
  await settle(el)
}

const toasts: unknown[] = []
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  localStorage.clear()
  toasts.length = 0
  window.addEventListener('caribou:toast', onToast)
})

afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  document.body.replaceChildren()
  activeUserKey.value = null
  users.value = new Map()
  statusCache.value = new Map()
  vi.restoreAllMocks()
})

// The poll builder (#55).
const pollToggle = (el: CaribouComposeDialog) => $(el, 'caribou-icon-button[data-action="toggle-poll"]')!
const options = (el: CaribouComposeDialog) => [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('[data-poll] input[data-option]')]

async function fill(el: CaribouComposeDialog, i: number, text: string) {
  const input = options(el)[i]!
  input.value = text
  input.dispatchEvent(new Event('input'))
  await settle(el)
}

async function openPoll(el: CaribouComposeDialog) {
  inner(pollToggle(el)).click()
  await settle(el)
}

describe('<caribou-compose-dialog> poll builder', () => {
  it('adds a poll with two empty options; Post waits for text in both', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    expect($(el, '[data-poll]')).toBeNull()
    await openPoll(el)
    expect(inner(pollToggle(el)).getAttribute('aria-pressed')).toBe('true')
    expect(options(el)).toHaveLength(2)
    expect(options(el).map((o) => o.getAttribute('aria-label'))).toEqual(['Option 1', 'Option 2'])
    expect(options(el)[0]!.maxLength).toBe(25)
    await type(el, 'which?')
    expect(postButton(el).disabled).toBe(true)
    await fill(el, 0, 'Tea')
    expect(postButton(el).disabled).toBe(true)
    await fill(el, 1, 'tea')
    expect(postButton(el).disabled).toBe(true)
    expect($(el, '[data-poll-problem]')?.textContent).toContain('same')
    await fill(el, 1, 'Coffee')
    expect(postButton(el).disabled).toBe(false)
  })

  it('options go up to the server\'s limit, and come off down to two', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    await openPoll(el)
    const add = () => $(el, 'caribou-button[data-action="add-option"]')
    inner(add()!).click()
    await settle(el)
    expect(options(el)).toHaveLength(3)
    expect(add()).toBeNull()
    const removes = () => [...el.shadowRoot!.querySelectorAll('caribou-icon-button[data-action="remove-option"]')]
    expect(removes()).toHaveLength(3)
    await fill(el, 2, 'third')
    inner(removes()[0]!).click()
    await settle(el)
    expect(options(el).map((o) => o.value)).toEqual(['', 'third'])
    expect(removes()).toHaveLength(0)
  })

  it('durations stay inside the server\'s range, one day by default', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    await openPoll(el)
    const select = $<HTMLSelectElement>(el, '#compose-poll-duration')!
    const values = [...select.options].map((o) => Number(o.value))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(300)
    expect(Math.max(...values)).toBeLessThanOrEqual(86400)
    expect(select.value).toBe('86400')
  })

  it('posts the poll with its settings and keeps it in the draft until then', async () => {
    const client = signIn()
    const create = vi.spyOn(client, 'createStatus').mockResolvedValue({ id: 'n1', account: ME } as unknown as mastodon.v1.Status)
    const el = await mount()
    await compose(el)
    await type(el, 'which?')
    await openPoll(el)
    await fill(el, 0, 'Tea')
    await fill(el, 1, 'Coffee')
    const select = $<HTMLSelectElement>(el, '#compose-poll-duration')!
    select.value = '3600'
    select.dispatchEvent(new Event('change'))
    const multiple = $<HTMLInputElement>(el, 'input[data-poll-multiple]')!
    multiple.checked = true
    multiple.dispatchEvent(new Event('change'))
    const hide = $<HTMLInputElement>(el, 'input[data-poll-hide-totals]')!
    hide.checked = true
    hide.dispatchEvent(new Event('change'))
    await settle(el)
    expect(loadDraft(KEY as never, 'new')?.poll).toEqual({ options: ['Tea', 'Coffee'], expiresIn: 3600, multiple: true, hideTotals: true })
    postButton(el).click()
    await settle(el)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'which?', poll: { options: ['Tea', 'Coffee'], expiresIn: 3600, multiple: true, hideTotals: true },
    }), expect.anything())
  })

  it('a poll and media exclude each other', async () => {
    signIn()
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'pic', media: [{ id: 'm1', type: 'image', url: 'u', previewUrl: null, description: '' }] }))
    const el = await mount()
    await compose(el)
    expect(inner(pollToggle(el)).getAttribute('aria-disabled')).toBe('true')
    inner(pollToggle(el)).click()
    await settle(el)
    expect($(el, '[data-poll]')).toBeNull()

    // And the other way: with a poll, no media can be added.
    inner($(el, 'caribou-button[data-action="remove-media"]')!).click()
    await settle(el)
    await openPoll(el)
    expect($(el, '[data-poll]')).not.toBeNull()
    expect(inner($(el, 'caribou-icon-button[data-action="add-media"]')!).getAttribute('aria-disabled')).toBe('true')
    expect($<HTMLInputElement>(el, 'input[type="file"]')!.disabled).toBe(true)
  })

  it('pressing the poll button again removes the poll', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    await openPoll(el)
    await fill(el, 0, 'x')
    await openPoll(el)
    expect($(el, '[data-poll]')).toBeNull()
    expect(loadDraft(KEY as never, 'new')).toBeNull()
  })

  it('an edit has no poll button', async () => {
    signIn()
    const el = await mount()
    el.showEdit({ id: '9', visibility: 'public', mediaAttachments: [], account: ME } as unknown as mastodon.v1.Status,
      { id: '9', text: 'hi', spoilerText: '' } as mastodon.v1.StatusSource)
    await settle(el)
    expect($(el, 'caribou-icon-button[data-action="toggle-poll"]')).toBeNull()
  })

  it('limits that arrive after the poll was made bring its duration into range, and Post checks it', async () => {
    // A server this file has not asked yet: limits are kept per server.
    addUserSession({
      userKey: 'alice@late.example', server: 'late.example', token: 'TOKEN', vapidKey: '', account: ME, createdAt: 1,
    } as unknown as UserSession)
    const client = activeClient.value!
    let resolve!: (i: mastodon.v2.Instance) => void
    vi.spyOn(client, 'fetchInstance').mockImplementation(() => new Promise((r) => { resolve = r }))
    const el = await mount()
    await compose(el)
    await type(el, 'which?')
    await openPoll(el)
    await fill(el, 0, 'a')
    await fill(el, 1, 'b')
    expect($<HTMLSelectElement>(el, '#compose-poll-duration')!.value).toBe('86400')
    resolve({ configuration: { statuses: { maxCharacters: 100, maxMediaAttachments: 2 }, mediaAttachments: {},
      polls: { maxOptions: 4, maxCharactersPerOption: 50, minExpiration: 300, maxExpiration: 3600 } } } as unknown as mastodon.v2.Instance)
    await settle(el)
    const select = $<HTMLSelectElement>(el, '#compose-poll-duration')!
    expect([...select.options].map((o) => Number(o.value)).every((v) => v <= 3600)).toBe(true)
    expect(select.value).toBe('3600')
    expect(loadDraft('alice@late.example' as never, 'new')?.poll?.expiresIn).toBe(3600)
    expect(postButton(el).disabled).toBe(false)
  })

  it('a stored duration outside the list but in range is kept, with a readable label', async () => {
    signIn()
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'q', poll: { options: ['a', 'b'], expiresIn: 2 * 3600 + 1800, multiple: false, hideTotals: false } }))
    const el = await mount()
    await compose(el)
    const select = $<HTMLSelectElement>(el, '#compose-poll-duration')!
    expect(select.value).toBe('9000')
    expect(select.selectedOptions[0]!.textContent).toBe('2 hours 30 minutes')
  })

  it('a stored duration out of range is moved into range', async () => {
    signIn()
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'q', poll: { options: ['a', 'b'], expiresIn: 60, multiple: false, hideTotals: false } }))
    const el = await mount()
    await compose(el)
    // The limits are in: the duration was moved into range.
    expect($<HTMLSelectElement>(el, '#compose-poll-duration')!.value).toBe('300')
    expect(postButton(el).disabled).toBe(false)
  })

  it('options made before the limits came in are checked against them at Post', async () => {
    addUserSession({
      userKey: 'alice@late2.example', server: 'late2.example', token: 'TOKEN', vapidKey: '', account: ME, createdAt: 1,
    } as unknown as UserSession)
    const client = activeClient.value!
    let resolve!: (i: mastodon.v2.Instance) => void
    vi.spyOn(client, 'fetchInstance').mockImplementation(() => new Promise((r) => { resolve = r }))
    const create = vi.spyOn(client, 'createStatus')
    const el = await mount()
    await compose(el)
    await type(el, 'which?')
    await openPoll(el)
    inner($(el, 'caribou-button[data-action="add-option"]')!).click()
    await settle(el)
    inner($(el, 'caribou-button[data-action="add-option"]')!).click()
    await settle(el)
    await fill(el, 0, 'a')
    await fill(el, 1, 'b')
    await fill(el, 2, 'c')
    await fill(el, 3, 'x'.repeat(40))
    expect(postButton(el).disabled).toBe(false)
    resolve({ configuration: { statuses: { maxCharacters: 100, maxMediaAttachments: 2 }, mediaAttachments: {},
      polls: { maxOptions: 3, maxCharactersPerOption: 25, minExpiration: 300, maxExpiration: 86400 } } } as unknown as mastodon.v2.Instance)
    await settle(el)
    expect(postButton(el).disabled).toBe(true)
    expect($(el, '[data-poll-problem]')?.textContent).toBe('This server allows at most 3 options.')
    postButton(el).click()
    await settle(el)
    expect(create).not.toHaveBeenCalled()
    // Remove one: now the long option is the problem.
    inner(el.shadowRoot!.querySelectorAll('caribou-icon-button[data-action="remove-option"]')[2]!).click()
    await settle(el)
    expect($(el, '[data-poll-problem]')?.textContent).toBe('Option 3 is longer than 25 characters.')
    expect(postButton(el).disabled).toBe(true)
    await fill(el, 2, 'short')
    expect($(el, '[data-poll-problem]')?.textContent).toBe('')
    expect(postButton(el).disabled).toBe(false)
  })

  it('a stored draft with too long an option cannot be posted until fixed', async () => {
    signIn()
    saveDraft(KEY as never, 'new', emptyDraft({ text: 'q', poll: { options: ['a', 'y'.repeat(30)], expiresIn: 3600, multiple: false, hideTotals: false } }))
    const el = await mount()
    await compose(el)
    expect(postButton(el).disabled).toBe(true)
    expect($(el, '[data-poll-problem]')?.textContent).toBe('Option 2 is longer than 25 characters.')
  })
})
