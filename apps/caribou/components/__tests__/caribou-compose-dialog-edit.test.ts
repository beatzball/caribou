import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instance, MediaAttachment, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, emptyDraft, findRedraftSlot, loadDraft, saveDraft, statusCache, users,
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
    configuration: { statuses: { maxCharacters: 20, maxMediaAttachments: 2 }, mediaAttachments: {} },
  } as unknown as Instance)
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

async function compose(el: CaribouComposeDialog, inReplyTo?: Status) {
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

function own(over: Partial<Status> = {}): Status {
  return {
    id: '7', content: '<p>teh typo</p>', visibility: 'unlisted', spoilerText: '', sensitive: false,
    language: 'en', inReplyToId: null, editedAt: null, account: ME,
    mediaAttachments: [{ id: 'm1', type: 'image', url: 'https://x/m1.png', previewUrl: 'https://x/m1s.png', description: 'a cat' }],
    ...over,
  } as unknown as Status
}

async function edit(el: CaribouComposeDialog, status: Status, source = { id: status.id, text: 'teh typo', spoilerText: '' }) {
  window.dispatchEvent(new CustomEvent('caribou:compose', { detail: { edit: { status, source } } }))
  await settle(el)
}

describe('caribou-compose-dialog edit mode', () => {
  it('opens filled with the source text, visibility fixed, media shown read-only', async () => {
    signIn()
    const el = await mount()
    await edit(el, own(), { id: '7', text: 'teh typo', spoilerText: 'cw' })
    expect($(el, 'h2')!.textContent).toBe('Edit post')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('teh typo')
    expect($<HTMLInputElement>(el, '#compose-cw')!.value).toBe('cw')
    const select = $<HTMLSelectElement>(el, 'select')!
    expect(select.value).toBe('unlisted')
    expect(select.disabled).toBe(true)
    expect($(el, '#compose-visibility-note')!.textContent).toBe('Visibility cannot change.')
    expect($(el, '[data-action="add-media"]')).toBeNull()
    expect($(el, '[data-action="remove-media"]')).toBeNull()
    expect($(el, 'li[data-media="m1"] img')!.getAttribute('alt')).toBe('a cat')
    expect($(el, 'caribou-button.post')!.textContent!.trim()).toBe('Save')
  })

  it('saves with PUT, keeps the media and language, updates the cache, closes, and stores no draft', async () => {
    const client = signIn()
    const edited = { ...own(), content: '<p>the typo</p>', editedAt: '2026-11-01T00:00:00.000Z' }
    const editStatus = vi.spyOn(client, 'editStatus').mockResolvedValue(edited as Status)
    statusCache.value = new Map([['7', own()]])
    const el = await mount()
    await edit(el, own())
    await type(el, 'the typo')
    expect(loadDraft(KEY, 'new')).toBeNull()
    postButton(el).click()
    await settle(el)
    expect(editStatus).toHaveBeenCalledWith('7', {
      status: 'the typo', spoilerText: '', sensitive: false, language: 'en', mediaIds: ['m1'],
    })
    expect(statusCache.value.get('7')!.content).toBe('<p>the typo</p>')
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
    expect(toasts).toContainEqual({ kind: 'info', message: 'Post updated' })
    expect(loadDraft(KEY, 'new')).toBeNull()
  })

  it('a failed save keeps the dialog open with the text, and the post as it was', async () => {
    const client = signIn()
    vi.spyOn(client, 'editStatus').mockRejectedValue(new Error('nope'))
    statusCache.value = new Map([['7', own()]])
    const el = await mount()
    await edit(el, own())
    await type(el, 'changed')
    postButton(el).click()
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(true)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('changed')
    expect(statusCache.value.get('7')!.content).toBe('<p>teh typo</p>')
    expect(toasts).toContainEqual({ kind: 'error', message: 'Could not save the edit: nope' })
  })

  it('a new post after an edit is a plain new post again', async () => {
    signIn()
    const el = await mount()
    await edit(el, own())
    $<HTMLDialogElement>(el, 'dialog')!.close()
    $<HTMLDialogElement>(el, 'dialog')!.dispatchEvent(new Event('close'))
    await settle(el)
    await compose(el)
    expect($(el, 'h2')!.textContent).toBe('New post')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('')
    expect($<HTMLSelectElement>(el, 'select')!.disabled).toBe(false)
  })

  it('a redraft opens a new post filled from the deleted one, kept as a draft', async () => {
    const client = signIn()
    const create = vi.spyOn(client, 'createStatus').mockResolvedValue(own({ id: '8' }))
    const el = await mount()
    const redraft = emptyDraft({
      text: 'again', spoilerText: 'cw', cw: true, visibility: 'private', inReplyToId: '5',
      sensitive: true, language: 'de', media: [],
    })
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: { redraft } }))
    await settle(el)
    expect($(el, 'h2')!.textContent).toBe('Reply')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('again')
    expect($<HTMLSelectElement>(el, 'select')!.value).toBe('private')
    expect(loadDraft(KEY, 'reply:5')?.text).toBe('again')
    postButton(el).click()
    await settle(el)
    expect(create.mock.calls[0]![0]).toEqual({
      status: 'again', visibility: 'private', spoilerText: 'cw', sensitive: true, inReplyToId: '5', language: 'de',
    })
  })

  it('refuses to save an edit of a post with a poll (Mastodon would remove the poll)', async () => {
    const client = signIn()
    const editStatus = vi.spyOn(client, 'editStatus')
    const el = await mount()
    await edit(el, own({ poll: { id: 'p', options: [] } } as unknown as Partial<Status>))
    postButton(el).click()
    await settle(el)
    expect(editStatus).not.toHaveBeenCalled()
    expect(toasts).toContainEqual({ kind: 'error', message: expect.stringContaining('poll') })
  })

  it('saves with the newest known media and language, when the post changed after the dialog opened', async () => {
    const client = signIn()
    const editStatus = vi.spyOn(client, 'editStatus').mockResolvedValue(own())
    const el = await mount()
    await edit(el, own())
    // An edit from elsewhere lands while the dialog is open.
    statusCache.value = new Map([['7', own({
      editedAt: '2026-11-01T00:00:00.000Z', language: 'de',
      mediaAttachments: [{ id: 'm1' }, { id: 'm9' }] as MediaAttachment[],
    })]])
    postButton(el).click()
    await settle(el)
    expect(editStatus.mock.calls[0]![1]).toMatchObject({ language: 'de', mediaIds: ['m1', 'm9'] })
  })

  it('a redraft never overwrites an unsent draft; it is kept on its own and opens first next time', async () => {
    const client = signIn()
    vi.spyOn(client, 'createStatus').mockResolvedValue(own({ id: '8' }))
    saveDraft(KEY, 'new', emptyDraft({ text: 'precious existing draft' }))
    const el = await mount()
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: { redraft: emptyDraft({ text: 'from the deleted post' }) } }))
    await settle(el)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('from the deleted post')
    expect($(el, '[data-redraft-note]')!.textContent).toContain('opens first')
    // Stored at once, so Esc, Cancel or a reload loses nothing.
    const slot = findRedraftSlot(KEY)!
    expect(slot).toMatch(/^redraft:/)
    expect(loadDraft(KEY, slot)?.text).toBe('from the deleted post')
    await type(el, 'redraft, again')
    expect(loadDraft(KEY, slot)?.text).toBe('redraft, again')
    expect(loadDraft(KEY, 'new')?.text).toBe('precious existing draft')

    // Esc: closed, kept. The next new post opens it.
    $<HTMLDialogElement>(el, 'dialog')!.close()
    $<HTMLDialogElement>(el, 'dialog')!.dispatchEvent(new Event('close'))
    await settle(el)
    await compose(el)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('redraft, again')
    postButton(el).click()
    await settle(el)
    expect(findRedraftSlot(KEY)).toBeNull()
    expect(loadDraft(KEY, 'new')?.text).toBe('precious existing draft')

    // Then the other draft, as it was.
    await compose(el)
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('precious existing draft')
  })

  it('an account switch while a kept redraft is open says where it went, truthfully', async () => {
    signIn()
    saveDraft(KEY, 'new', emptyDraft({ text: 'precious existing draft' }))
    const el = await mount()
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: { redraft: emptyDraft({ text: 'from the deleted post' }) } }))
    await settle(el)
    activeUserKey.value = null
    await settle(el)
    expect($<HTMLDialogElement>(el, 'dialog')!.open).toBe(false)
    expect(toasts).toContainEqual({
      kind: 'info',
      message: 'Your redraft is saved for the account you started it with. It opens the next time you write a new post there.',
    })
    expect(loadDraft(KEY, findRedraftSlot(KEY)!)?.text).toBe('from the deleted post')
    expect(loadDraft(KEY, 'new')?.text).toBe('precious existing draft')
  })

  it('a redraft of a reply shows the post it replies to, when given', async () => {
    signIn()
    const el = await mount()
    const parentPost = { ...own({ id: '5', content: '<p>the question</p>' }), account: { id: 'b1', acct: 'bob', username: 'bob', displayName: 'Bob' } }
    window.dispatchEvent(new CustomEvent('caribou:compose', {
      detail: { redraft: emptyDraft({ text: 'answer', inReplyToId: '5' }), inReplyTo: parentPost },
    }))
    await settle(el)
    expect($(el, '[data-reply-to]')!.textContent).toContain('the question')
    expect($<HTMLTextAreaElement>(el, 'textarea')!.value).toBe('answer')
  })
})
