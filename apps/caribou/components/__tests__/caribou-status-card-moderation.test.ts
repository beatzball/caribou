import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Relationship, Status } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  _testOnlyResetRelationships, activeClient, activeUserKey, addUserSession, relationshipCache, relationshipKey,
  statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouConfirmDialog } from '../caribou-confirm-dialog.js'


const ME = toUserKey('alice', 'example.social')
const bob = { id: '42', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' }
const carol = { id: '43', acct: 'carol', username: 'carol', displayName: 'Carol', avatar: '', avatarStatic: '' }

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, content: '<p>hi</p>', createdAt: '2026-04-28T12:00:00Z', visibility: 'public', account: bob, ...over,
}) as unknown as Status

const rel = (id: string, patch: Partial<Relationship> = {}) =>
  ({ id, following: false, muting: false, blocking: false, ...patch }) as Relationship

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function signIn() {
  addUserSession({
    userKey: ME, server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
  })
}

async function mount(status: Status, context = 'home'): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.instance = 'example.social'
  el.setAttribute('filter-context', context)
  el.status = status
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle the post-mount render */ }
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const item = (el: Element, action: string) => $(el, `caribou-menu.more button[data-action="${action}"]`)!
const cached = (id: string) => relationshipCache.value.get(relationshipKey(ME, id))

async function settle(el: CaribouStatusCard) {
  for (let i = 0; i < 5; i++) await el.updateComplete
  await new Promise((r) => setTimeout(r, 0))
  await el.updateComplete
}

const dialog = () => document.querySelector<CaribouConfirmDialog>('caribou-confirm-dialog')

beforeEach(() => {
  _testOnlyResetRelationships()
  document.body.replaceChildren()
  statusCache.value = new Map()
  relationshipCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  // happy-dom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { vi.restoreAllMocks() })

describe('<caribou-status-card> post menu', () => {
  it('has no menu signed out, and no Mute or Block on the reader\'s own post', async () => {
    expect($(await mount(post('1')), 'caribou-menu.more')).toBeNull()
    signIn()
    const own = await mount(post('2', { account: { ...bob, id: 'me', acct: 'alice' } }))
    expect($(own, 'caribou-menu.more button[data-action="mute"]')).toBeNull()
    expect($(own, 'caribou-menu.more button[data-action="block"]')).toBeNull()
  })

  it('names the author in Mute and Block', async () => {
    signIn()
    const el = await mount(post('3'))
    expect($(el, 'caribou-menu.more')!.getAttribute('label')).toBe('More actions for post by @bob')
    expect(item(el, 'mute').textContent).toBe('Mute @bob')
    expect(item(el, 'block').textContent).toBe('Block @bob')
  })

  it('reads Unmute and Unblock from a known relationship', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '42'), rel('42', { muting: true, blocking: true })]])
    const el = await mount(post('4'), 'account')
    expect(item(el, 'mute').textContent).toBe('Unmute @bob')
    expect(item(el, 'block').textContent).toBe('Unblock @bob')
  })

  it('Mute: says so with Undo in the post\'s place at once, focused, and hides the author\'s other posts', async () => {
    signIn()
    const d = deferred<Relationship>()
    const mute = vi.spyOn(activeClient.value!, 'mute').mockReturnValue(d.promise)
    const el = await mount(post('5'))
    const other = await mount(post('6'))
    const unrelated = await mount(post('7', { account: carol }))
    item(el, 'mute').click()
    await settle(el)
    expect(mute).toHaveBeenCalledWith('42')
    expect(cached('42')?.muting).toBe(true)
    expect($(el, '#moderated-msg')!.textContent).toBe('You muted @bob.')
    // The shared button; its name says what it undoes.
    const undo = $(el, 'caribou-button.undo')!
    expect(undo.textContent).toBe('Undo mute of @bob')
    expect(el.shadowRoot!.activeElement).toBe(undo)
    expect(el.hasAttribute('hidden')).toBe(false)
    await settle(other)
    expect(other.hasAttribute('hidden')).toBe(true)
    expect(unrelated.hasAttribute('hidden')).toBe(false)
    d.resolve(rel('42', { muting: true }))
    await settle(el)
    expect($(el, '#moderated-msg')).not.toBeNull()
  })

  it('a failed mute brings the post back and gives focus to the menu', async () => {
    signIn()
    const d = deferred<Relationship>()
    vi.spyOn(activeClient.value!, 'mute').mockReturnValue(d.promise)
    const el = await mount(post('8'))
    item(el, 'mute').click()
    await settle(el)
    d.reject(new Error('boom'))
    await settle(el)
    expect($(el, '#moderated-msg')).toBeNull()
    expect($(el, '.status-content')).not.toBeNull()
    expect(cached('42')).toBeUndefined()
    expect(el.shadowRoot!.activeElement).toBe($(el, 'caribou-menu.more'))
  })

  it('Undo unmutes and shows the post again', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'mute').mockResolvedValue(rel('42', { muting: true }))
    const unmute = vi.spyOn(activeClient.value!, 'unmute').mockResolvedValue(rel('42'))
    const el = await mount(post('9'))
    item(el, 'mute').click()
    await settle(el)
    $(el, 'caribou-button.undo')!.click()
    await settle(el)
    expect(unmute).toHaveBeenCalledWith('42')
    expect(cached('42')?.muting).toBe(false)
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('Block asks first; Cancel does nothing', async () => {
    signIn()
    const block = vi.spyOn(activeClient.value!, 'block')
    const el = await mount(post('10'))
    item(el, 'block').click()
    await settle(el)
    const d = dialog()!
    await d.updateComplete
    expect(d.shadowRoot!.querySelector('h2')!.textContent).toBe('Block @bob?')
    d.shadowRoot!.querySelector<HTMLElement>('caribou-button.cancel')!.click()
    await settle(el)
    expect(dialog()).toBeNull()
    expect(block).not.toHaveBeenCalled()
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('Block, confirmed, blocks and says so in the post\'s place', async () => {
    signIn()
    const block = vi.spyOn(activeClient.value!, 'block').mockResolvedValue(rel('42', { blocking: true }))
    const el = await mount(post('11'))
    item(el, 'block').click()
    await settle(el)
    const d = dialog()!
    await d.updateComplete
    d.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()
    await settle(el)
    expect(block).toHaveBeenCalledWith('42')
    expect($(el, '#moderated-msg')!.textContent).toBe('You blocked @bob.')
    expect(cached('42')?.blocking).toBe(true)
  })

  it('hides a boost by a muted booster', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '43'), rel('43', { muting: true })]])
    const boost = post('12', { account: carol, reblog: post('13') })
    expect((await mount(boost)).hasAttribute('hidden')).toBe(true)
  })

  it('keeps a muted author\'s posts on their own profile', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '42'), rel('42', { muting: true })]])
    expect((await mount(post('14'), 'account')).hasAttribute('hidden')).toBe(false)
  })

  it('does not read relationships for a card from another instance', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '42'), rel('42', { muting: true })]])
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.instance = 'other.example'
    el.setAttribute('filter-context', 'public')
    el.status = post('15')
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* settle */ }
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, 'caribou-menu.more')).toBeNull()
  })

  // Undo has focus the moment Mute is chosen, so Enter often comes before
  // the server has answered the mute.
  it('Undo pressed before the mute answered still unmutes, and the post stays', async () => {
    signIn()
    const d = deferred<Relationship>()
    vi.spyOn(activeClient.value!, 'mute').mockReturnValue(d.promise)
    const unmute = vi.spyOn(activeClient.value!, 'unmute').mockResolvedValue(rel('42'))
    const el = await mount(post('20'))
    item(el, 'mute').click()
    await settle(el)
    $(el, 'caribou-button.undo')!.click()
    await settle(el)
    expect($(el, '.status-content')).not.toBeNull()
    d.resolve(rel('42', { muting: true, mutingNotifications: true }))
    await settle(el)
    expect(unmute).toHaveBeenCalledWith('42')
    expect(cached('42')?.muting).toBe(false)
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('a Block dialog closes with no when the account changes, and blocks nobody', async () => {
    signIn()
    const block = vi.spyOn(activeClient.value!, 'block')
    const el = await mount(post('21'))
    item(el, 'block').click()
    await settle(el)
    expect(dialog()).not.toBeNull()
    addUserSession({
      userKey: toUserKey('carol', 'other.example'), server: 'other.example', token: 't2', vapidKey: '', createdAt: 0,
      account: { id: 'c', acct: 'carol', username: 'carol' } as Account,
    })
    await settle(el)
    expect(dialog()).toBeNull()
    expect(block).not.toHaveBeenCalled()
  })

  it('a Block confirmed after the account changed sends nothing', async () => {
    signIn()
    const el = await mount(post('22'))
    const oldClient = activeClient.value!
    const oldBlock = vi.spyOn(oldClient, 'block')
    item(el, 'block').click()
    await settle(el)
    const d = dialog()!
    await d.updateComplete
    // The switch lands while the dialog is open but before it notices.
    activeUserKey.value = null
    activeUserKey.value = ME
    const newBlock = vi.spyOn(activeClient.value!, 'block')
    const confirm = d.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')
    confirm?.click()
    await settle(el)
    expect(oldBlock).not.toHaveBeenCalled()
    expect(newBlock).not.toHaveBeenCalled()
  })

  it('the thread\'s main post by a muted author stays, behind a note with Show', async () => {
    signIn()
    relationshipCache.value = new Map([[relationshipKey(ME, '42'), rel('42', { muting: true })]])
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.instance = 'example.social'
    el.variant = 'focused'
    el.setAttribute('filter-context', 'thread')
    el.status = post('23')
    document.body.appendChild(el)
    while (!(await el.updateComplete)) { /* settle */ }
    expect(el.hasAttribute('hidden')).toBe(false)
    expect($(el, '.notice p')!.textContent).toBe('You muted @bob.')
    const show = $(el, 'button.filter-toggle')!
    expect(show.getAttribute('aria-label')).toBe('Show post by @bob')
    show.click()
    await el.updateComplete
    expect($(el, '.status-content')).not.toBeNull()
  })

  it('a pending mute\'s notice and its failure stay with the account that made it', async () => {
    signIn()
    const toasts: string[] = []
    const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message)
    window.addEventListener('caribou:toast', onToast)
    const d = deferred<Relationship>()
    vi.spyOn(activeClient.value!, 'mute').mockReturnValue(d.promise)
    const el = await mount(post('30'))
    item(el, 'mute').click()
    await settle(el)
    expect($(el, '#moderated-msg')).not.toBeNull()
    addUserSession({
      userKey: toUserKey('carol', 'other.example'), server: 'other.example', token: 't2', vapidKey: '', createdAt: 0,
      account: { id: 'c', acct: 'carol', username: 'carol' } as Account,
    })
    await settle(el)
    expect($(el, '#moderated-msg')).toBeNull()
    d.reject(new Error('boom'))
    await settle(el)
    expect(toasts).toEqual([])
    expect($(el, '#moderated-msg')).toBeNull()
    window.removeEventListener('caribou:toast', onToast)
  })

  it('Block confirmed, then the account changes before the answer is read: nothing is sent', async () => {
    signIn()
    const oldBlock = vi.spyOn(activeClient.value!, 'block')
    const el = await mount(post('31'))
    item(el, 'block').click()
    await settle(el)
    const d = dialog()!
    await d.updateComplete
    // Confirm first; the switch lands before the card reads the answer.
    d.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()
    addUserSession({
      userKey: toUserKey('carol', 'other.example'), server: 'other.example', token: 't2', vapidKey: '', createdAt: 0,
      account: { id: 'c', acct: 'carol', username: 'carol' } as Account,
    })
    const newBlock = vi.spyOn(activeClient.value!, 'block')
    await settle(el)
    expect(oldBlock).not.toHaveBeenCalled()
    expect(newBlock).not.toHaveBeenCalled()
    expect($(el, '#moderated-msg')).toBeNull()
  })
})
