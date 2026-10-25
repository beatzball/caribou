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

function signIn(): NonNullable<typeof activeClient.value> {
  addUserSession({
    userKey: KEY, server: 'example.social', token: 'TOKEN',
    vapidKey: '', account: ME, createdAt: 1,
  } as unknown as UserSession)
  const client = activeClient.value!
  vi.spyOn(client, 'fetchInstance').mockResolvedValue({
    configuration: { statuses: { maxCharacters: 20, maxMediaAttachments: 2 }, mediaAttachments: {} },
  } as unknown as mastodon.v2.Instance)
  return client
}

function parent(over: Partial<mastodon.v1.Status> = {}): mastodon.v1.Status {
  return {
    id: '42', content: '<p>original <b>post</b></p>', visibility: 'private', spoilerText: '',
    account: { id: 'b1', acct: 'bob@example.net', username: 'bob', displayName: 'Bob' },
    mentions: [{ acct: 'alice' }, { acct: 'carol' }],
    ...over,
  } as unknown as mastodon.v1.Status
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

function postButton(el: CaribouComposeDialog) {
  return $<HTMLButtonElement>(el, 'button.post')!
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

describe('caribou-compose-dialog', () => {
  it('opens on caribou:compose when signed in, and focuses the text field', async () => {
    signIn()
    const el = await mount()
    expect($(el, 'dialog')).toBeNull()
    await compose(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(true)
    expect($(el, 'h2')!.textContent).toBe('New post')
    expect(el.shadowRoot!.activeElement?.localName).toBe('textarea')
  })

  it('does nothing when signed out', async () => {
    const el = await mount()
    await compose(el)
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, composed: true }))
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
  })

  it('opens on the n key, but not while typing in a text field', async () => {
    signIn()
    const el = await mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, composed: true }))
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }))
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, composed: true }))
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(true)
  })

  it('only the newest of two mounted dialogs answers', async () => {
    signIn()
    const a = await mount()
    const b = await mount()
    await compose(b)
    expect($<HTMLDialogElement>(a, 'dialog')?.open ?? false).toBe(false)
    expect($<HTMLDialogElement>(b, 'dialog')!.open).toBe(true)
  })

  it('counts against the instance limit and disables Post when empty or over', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    expect($(el, '.count')!.textContent).toBe('20')
    expect(postButton(el).disabled).toBe(true)
    await type(el, 'hello')
    expect($(el, '.count')!.textContent).toBe('15')
    expect(postButton(el).disabled).toBe(false)
    await type(el, 'x'.repeat(21))
    expect($(el, '.count')!.textContent).toBe('-1')
    expect($(el, '.count')!.hasAttribute('data-over')).toBe(true)
    expect(postButton(el).disabled).toBe(true)
    await type(el, '   ')
    expect(postButton(el).disabled).toBe(true)
  })

  it('counts the content warning only while it is on', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    await type(el, 'abc')
    $<HTMLButtonElement>(el, '[data-action="toggle-cw"]')!.click()
    await settle(el)
    const cw = $<HTMLInputElement>(el, '#compose-cw')!
    cw.value = 'spoiler'
    cw.dispatchEvent(new Event('input'))
    await settle(el)
    expect($(el, '.count')!.textContent).toBe(String(20 - 3 - 7))
    $<HTMLButtonElement>(el, '[data-action="toggle-cw"]')!.click()
    await settle(el)
    expect($(el, '#compose-cw')).toBeNull()
    expect($(el, '.count')!.textContent).toBe('17')
  })

  it('reply mode shows the post, prefills mentions without yourself and inherits visibility', async () => {
    signIn()
    const el = await mount()
    await compose(el, parent())
    expect($(el, 'h2')!.textContent).toBe('Reply')
    expect($(el, '[data-reply-to]')!.textContent).toContain('original post')
    expect($(el, '[data-reply-to]')!.querySelector('b')).toBeNull()
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('@bob@example.net @carol ')
    expect($<HTMLSelectElement>(el, 'select')!.value).toBe('private')
  })

  it('a reply carries the parent’s content warning', async () => {
    signIn()
    const el = await mount()
    await compose(el, parent({ spoilerText: 'food' }))
    expect($<HTMLInputElement>(el, '#compose-cw')!.value).toBe('food')
  })

  it('stores the draft as you type, keeps it on close, and restores it', async () => {
    signIn()
    const el = await mount()
    await compose(el)
    await type(el, 'half written')
    expect(loadDraft(KEY, 'new')?.text).toBe('half written')
    $<HTMLButtonElement>(el, '[data-action="cancel"]')!.click()
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
    await compose(el)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('half written')
  })

  it('keeps a reply draft apart from the new-post draft', async () => {
    signIn()
    saveDraft(KEY, 'new', emptyDraft({ text: 'my post' }))
    const el = await mount()
    await compose(el, parent())
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('@bob@example.net @carol ')
  })

  it('posts with Ctrl+Enter, closes, clears the draft and toasts', async () => {
    const client = signIn()
    const create = vi.spyOn(client, 'createStatus').mockResolvedValue(
      { id: 'new', account: ME } as unknown as mastodon.v1.Status)
    const el = await mount()
    await compose(el, parent())
    await type(el, '@bob@example.net hi')
    $<HTMLTextAreaElement>(el, 'textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await settle(el)
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toEqual({
      status: '@bob@example.net hi', visibility: 'private', inReplyToId: '42',
    })
    expect(create.mock.calls[0]![1]?.idempotencyKey).toEqual(expect.any(String))
    expect($<HTMLDialogElement>(el, 'dialog')?.open ?? false).toBe(false)
    expect(loadDraft(KEY, 'reply:42')).toBeNull()
    expect(statusCache.value.has('new')).toBe(true)
    expect(toasts).toEqual([{ kind: 'info', message: 'Reply posted' }])
  })

  it('on failure keeps the dialog open with the draft and toasts the error', async () => {
    const client = signIn()
    vi.spyOn(client, 'createStatus').mockRejectedValue(new Error('Validation failed'))
    const el = await mount()
    await compose(el)
    await type(el, 'keep me')
    $<HTMLFormElement>(el, 'form')!.requestSubmit()
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(true)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('keep me')
    expect(loadDraft(KEY, 'new')?.text).toBe('keep me')
    expect(toasts).toEqual([{ kind: 'error', message: 'Could not post: Validation failed' }])
  })

  it('disables Post while media uploads, then attaches it', async () => {
    const client = signIn()
    let finish!: (m: mastodon.v1.MediaAttachment) => void
    vi.spyOn(client, 'uploadMedia').mockReturnValue(new Promise((r) => { finish = r }))
    const el = await mount()
    await compose(el)
    await type(el, 'pic')
    const input = $<HTMLInputElement>(el, 'input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png', { type: 'image/png' })], configurable: true })
    input.dispatchEvent(new Event('change'))
    await settle(el)
    expect($(el, '[data-pending] .state')!.textContent!.trim()).toBe('Uploading…')
    expect(postButton(el).disabled).toBe(true)
    finish({ id: 'm1', type: 'image', url: 'https://example.social/m1.png', previewUrl: 'https://example.social/m1s.png', description: null } as unknown as mastodon.v1.MediaAttachment)
    await settle(el)
    expect($(el, '[data-pending]')).toBeNull()
    expect($(el, '[data-media="m1"] img')!.getAttribute('src')).toBe('https://example.social/m1s.png')
    expect(postButton(el).disabled).toBe(false)
    expect(loadDraft(KEY, 'new')?.media.map((m) => m.id)).toEqual(['m1'])
  })

  it('stops at the instance media limit', async () => {
    const client = signIn()
    vi.spyOn(client, 'uploadMedia').mockReturnValue(new Promise(() => {}))
    const el = await mount()
    await compose(el)
    const input = $<HTMLInputElement>(el, 'input[type="file"]')!
    const files = ['a', 'b', 'c'].map((n) => new File(['x'], `${n}.png`, { type: 'image/png' }))
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    input.dispatchEvent(new Event('change'))
    await settle(el)
    expect(el.shadowRoot!.querySelectorAll('[data-pending]').length).toBe(2)
    expect($<HTMLInputElement>(el, 'input[type="file"]')!.disabled).toBe(true)
    expect(toasts).toEqual([{ kind: 'error', message: 'You can attach up to 2 files.' }])
  })

  it('saves alt text on an uploaded item', async () => {
    const client = signIn()
    const update = vi.spyOn(client, 'updateMedia').mockResolvedValue({} as mastodon.v1.MediaAttachment)
    saveDraft(KEY, 'new', emptyDraft({
      media: [{ id: 'm9', type: 'image', url: 'u', previewUrl: null, description: '' }],
    }))
    const el = await mount()
    await compose(el)
    const alt = $<HTMLInputElement>(el, '[data-media="m9"] input')!
    alt.value = 'a cat'
    alt.dispatchEvent(new Event('input'))
    alt.dispatchEvent(new Event('change'))
    await settle(el)
    expect(update).toHaveBeenCalledWith('m9', { description: 'a cat' })
    expect(loadDraft(KEY, 'new')?.media[0]?.description).toBe('a cat')
  })
})
