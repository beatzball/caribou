import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  activeClient, activeUserKey, addUserSession, deletedStatusIds, statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import type { CaribouConfirmDialog } from '../caribou-confirm-dialog.js'
import type { CaribouStatusHistory } from '../caribou-status-history.js'

type Status = mastodon.v1.Status

const ME = toUserKey('alice', 'example.social')
const alice = { id: 'me', acct: 'alice', username: 'alice', displayName: 'Alice', avatar: '', avatarStatic: '' }
const bob = { id: '42', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' }

const post = (id: string, over: Record<string, unknown> = {}) => ({
  id, content: '<p>teh typo</p>', createdAt: '2026-04-28T12:00:00Z', visibility: 'public', spoilerText: '',
  sensitive: false, language: 'en', inReplyToId: null, editedAt: null, mediaAttachments: [], account: alice, ...over,
}) as unknown as Status

function signIn(account: object | null = { id: 'me', acct: 'alice', username: 'alice' }) {
  addUserSession({
    userKey: ME, server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: account as mastodon.v1.Account,
  })
}

async function mount(status: Status, variant = 'timeline'): Promise<CaribouStatusCard> {
  const el = document.createElement('caribou-status-card') as CaribouStatusCard
  el.instance = 'example.social'
  el.setAttribute('filter-context', 'home')
  el.variant = variant as CaribouStatusCard['variant']
  el.status = status
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle the post-mount render */ }
  return el
}

async function settle(el: CaribouStatusCard) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await el.updateComplete
  }
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const item = (el: Element, action: string) => $(el, `caribou-menu.more button[data-action="${action}"]`)
const confirmEl = () => document.querySelector<CaribouConfirmDialog>('caribou-confirm-dialog')
const confirmYes = () => confirmEl()!.shadowRoot!.querySelector<HTMLElement>('caribou-button.confirm')!.click()

const events: CustomEvent[] = []
const onCompose = (e: Event) => events.push(e as CustomEvent)
const toasts: unknown[] = []
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  deletedStatusIds.value = new Set()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  events.length = 0
  toasts.length = 0
  window.addEventListener('caribou:compose', onCompose)
  window.addEventListener('caribou:toast', onToast)
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => {
  window.removeEventListener('caribou:compose', onCompose)
  window.removeEventListener('caribou:toast', onToast)
  vi.restoreAllMocks()
})

describe('<caribou-status-card> own post menu', () => {
  it('offers Edit, Delete and Delete & redraft on the reader\'s own post, not Mute or Block', async () => {
    signIn()
    const el = await mount(post('1'))
    expect($(el, 'caribou-menu.more')!.getAttribute('label')).toBe('More actions for your post')
    expect(item(el, 'edit')!.textContent).toBe('Edit')
    expect(item(el, 'delete')!.textContent).toBe('Delete')
    expect(item(el, 'redraft')!.textContent).toBe('Delete & redraft')
    expect(item(el, 'mute')).toBeNull()
  })

  it('compares account ids, not handles: a same-named account elsewhere is not the reader', async () => {
    signIn()
    const el = await mount(post('1', { account: { ...bob, id: '99', acct: 'alice' } }))
    expect(item(el, 'edit')).toBeNull()
  })

  it('has no own menu on another account\'s post, or before the reader\'s account id is known', async () => {
    signIn()
    expect(item(await mount(post('1', { account: bob })), 'edit')).toBeNull()
    users.value = new Map()
    activeUserKey.value = null
    signIn(null)
    expect(item(await mount(post('2')), 'edit')).toBeNull()
  })

  it('renders no menu in the first render, so it matches the server', async () => {
    signIn()
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.instance = 'example.social'
    el.status = post('1')
    document.body.appendChild(el)
    await el.updateComplete
    // The first render is done; `firstUpdated` has asked for a second one.
    expect(item(el, 'edit')).toBeNull()
  })

  it('Edit asks for the source and the current post, and opens compose in edit mode with them', async () => {
    signIn()
    const source = vi.spyOn(activeClient.value!, 'fetchStatusSource')
      .mockResolvedValue({ id: '1', text: 'teh typo', spoilerText: '' })
    const fetchStatus = vi.spyOn(activeClient.value!, 'fetchStatus').mockResolvedValue(post('1'))
    const el = await mount(post('1'))
    item(el, 'edit')!.click()
    await settle(el)
    expect(source).toHaveBeenCalledWith('1')
    expect(fetchStatus).toHaveBeenCalledWith('1')
    expect(events.at(-1)!.detail).toEqual({ edit: { status: post('1'), source: { id: '1', text: 'teh typo', spoilerText: '' } } })
  })

  it('Edit hands compose the current media and language, not the card\'s older copy', async () => {
    signIn()
    const newer = post('1', {
      content: '<p>fresh</p>', editedAt: '2026-04-28T13:00:00Z', language: 'de',
      mediaAttachments: [{ id: 'm2', type: 'image', url: 'u', previewUrl: 'p', description: '' }],
    })
    vi.spyOn(activeClient.value!, 'fetchStatusSource').mockResolvedValue({ id: '1', text: 'fresh', spoilerText: '' })
    vi.spyOn(activeClient.value!, 'fetchStatus').mockResolvedValue(newer)
    const el = await mount(post('1'))
    item(el, 'edit')!.click()
    await settle(el)
    const sent = (events.at(-1)!.detail as { edit: { status: Status } }).edit.status
    expect(sent.mediaAttachments.map((m) => m.id)).toEqual(['m2'])
    expect(sent.language).toBe('de')
  })

  it('Edit refuses a post with a poll, since Mastodon would drop the poll and its votes', async () => {
    signIn()
    const source = vi.spyOn(activeClient.value!, 'fetchStatusSource')
    const withPoll = post('1', { poll: { id: 'p', options: [{ title: 'a' }, { title: 'b' }] } })
    vi.spyOn(activeClient.value!, 'fetchStatus').mockResolvedValue(withPoll)
    const el = await mount(withPoll)
    item(el, 'edit')!.click()
    await settle(el)
    expect(events).toEqual([])
    expect(source).not.toHaveBeenCalled()
    expect(toasts).toContainEqual({
      kind: 'error', message: 'Caribou cannot edit a post with a poll yet: Mastodon would remove the poll and its votes.',
    })
  })

  it('Edit refuses when the current post has a poll the card did not know of', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'fetchStatusSource').mockResolvedValue({ id: '1', text: 'x', spoilerText: '' })
    vi.spyOn(activeClient.value!, 'fetchStatus').mockResolvedValue(post('1', { poll: { id: 'p', options: [] } }))
    const el = await mount(post('1'))
    item(el, 'edit')!.click()
    await settle(el)
    expect(events).toEqual([])
  })

  it('Edit toasts when the source cannot load', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'fetchStatusSource').mockRejectedValue(new Error('x'))
    vi.spyOn(activeClient.value!, 'fetchStatus').mockResolvedValue(post('1'))
    const el = await mount(post('1'))
    item(el, 'edit')!.click()
    await settle(el)
    expect(events).toEqual([])
    expect(toasts).toContainEqual({ kind: 'error', message: 'Could not open this post for editing. Try again.' })
  })

  it('Delete asks first; Cancel deletes nothing', async () => {
    signIn()
    const del = vi.spyOn(activeClient.value!, 'deleteStatus')
    const el = await mount(post('1'))
    item(el, 'delete')!.click()
    await settle(el)
    expect(confirmEl()!.shadowRoot!.querySelector('h2')!.textContent).toBe('Delete this post?')
    confirmEl()!.shadowRoot!.querySelector<HTMLElement>('caribou-button.cancel')!.click()
    await settle(el)
    expect(del).not.toHaveBeenCalled()
    expect(el.hasAttribute('hidden')).toBe(false)
  })

  it('Delete removes the card, and every other card of the post, after the confirm', async () => {
    signIn()
    statusCache.value = new Map([['1', post('1')]])
    const del = vi.spyOn(activeClient.value!, 'deleteStatus').mockResolvedValue(post('1'))
    const el = await mount(post('1'))
    const copy = await mount(post('1'))
    const boost = await mount(post('w', { account: bob, reblog: post('1') }))
    const focused = await mount(post('1'), 'focused')
    item(el, 'delete')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(del).toHaveBeenCalledWith('1')
    for (const c of [el, copy, boost]) {
      await settle(c)
      expect(c.hasAttribute('hidden')).toBe(true)
    }
    await settle(focused)
    expect($(focused, 'article.deleted')!.textContent!.trim()).toBe('You deleted this post.')
    expect(statusCache.value.has('1')).toBe(false)
    expect(toasts).toContainEqual({ kind: 'info', message: 'Post deleted' })
  })

  it('a failed delete hides the card at once, then brings it back', async () => {
    signIn()
    let reject!: (e: unknown) => void
    vi.spyOn(activeClient.value!, 'deleteStatus').mockReturnValue(new Promise((_, r) => { reject = r }))
    const el = await mount(post('1'))
    item(el, 'delete')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(el.hasAttribute('hidden')).toBe(true)
    reject(new Error('x'))
    await settle(el)
    expect(el.hasAttribute('hidden')).toBe(false)
    expect(toasts).toContainEqual({ kind: 'error', message: 'Could not delete this post. Try again.' })
  })

  it('Delete & redraft deletes, then opens compose with what the post had', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'deleteStatus').mockResolvedValue(post('1', {
      text: 'teh typo source', spoilerText: 'cw', visibility: 'private', sensitive: true, language: 'de',
      inReplyToId: '5', mediaAttachments: [{ id: 'm1', type: 'image', url: 'u', previewUrl: 'p', description: 'd' }],
    }))
    const el = await mount(post('1'))
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmEl()!.shadowRoot!.querySelector('caribou-button.confirm')!.textContent).toBe('Delete & redraft')
    confirmYes()
    await settle(el)
    const draft = (events.at(-1)!.detail as { redraft: Record<string, unknown> }).redraft
    expect(draft).toMatchObject({
      text: 'teh typo source', spoilerText: 'cw', cw: true, visibility: 'private', sensitive: true,
      language: 'de', inReplyToId: '5',
      media: [{ id: 'm1', type: 'image', url: 'u', previewUrl: 'p', description: 'd' }],
    })
  })

  it('after a delete, focus goes to the next post in the list', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'deleteStatus').mockResolvedValue(post('1'))
    const ul = document.createElement('ul')
    document.body.appendChild(ul)
    const cards: CaribouStatusCard[] = []
    for (const id of ['1', '2']) {
      const li = document.createElement('li')
      ul.appendChild(li)
      const el = document.createElement('caribou-status-card') as CaribouStatusCard
      el.instance = 'example.social'
      el.status = post(id)
      li.appendChild(el)
      while (!(await el.updateComplete)) { /* settle */ }
      cards.push(el)
    }
    item(cards[0]!, 'delete')!.click()
    await settle(cards[0]!)
    confirmYes()
    await settle(cards[0]!)
    await settle(cards[1]!)
    expect(document.activeElement).toBe(cards[1])
    expect(cards[1]!.shadowRoot!.activeElement?.localName).toBe('article')
  })

  it('a redraft of a reply hands compose the post it replies to, when known', async () => {
    signIn()
    const parent = post('5', { account: bob, content: '<p>question</p>' })
    statusCache.value = new Map([['5', parent]])
    vi.spyOn(activeClient.value!, 'deleteStatus').mockResolvedValue(post('1', { text: 'answer', inReplyToId: '5' }))
    const el = await mount(post('1', { inReplyToId: '5' }))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect((events.at(-1)!.detail as { inReplyTo: Status }).inReplyTo).toEqual(parent)
  })

  it('the redraft question says the poll is not kept', async () => {
    signIn()
    const el = await mount(post('1', { poll: { id: 'p', options: [] } }))
    item(el, 'redraft')!.click()
    await settle(el)
    expect(confirmEl()!.shadowRoot!.querySelector('p')!.textContent).toContain('The poll is not kept.')
  })

  it('a failed Delete & redraft opens no compose', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'deleteStatus').mockRejectedValue(new Error('x'))
    const el = await mount(post('1'))
    item(el, 'redraft')!.click()
    await settle(el)
    confirmYes()
    await settle(el)
    expect(events).toEqual([])
  })
})

describe('<caribou-status-card> edits', () => {
  it('shows "edited" as text in the first render, and a history button after mount', async () => {
    signIn()
    const el = document.createElement('caribou-status-card') as CaribouStatusCard
    el.instance = 'example.social'
    el.status = post('1', { editedAt: '2026-04-28T13:00:00Z' })
    document.body.appendChild(el)
    await el.updateComplete
    expect($(el, 'span.edited')!.textContent).toBe('edited')
    await settle(el)
    const mark = $(el, 'caribou-button.edited')!
    expect(mark.textContent).toBe('edited')
    // The visible word is short; the name says what the button does.
    const inner = mark.shadowRoot!.querySelector('button')!
    expect(inner.getAttribute('aria-label')).toMatch(/^Edited .+\. Show edit history$/)
    expect(inner.getAttribute('title')).toMatch(/^Edited /)
  })

  it('no mark on a post never edited', async () => {
    signIn()
    expect($(await mount(post('1')), '.edited')).toBeNull()
  })

  it('takes a newer edit from the cache, so a card holding an old copy (a thread) shows it', async () => {
    signIn()
    const el = await mount(post('1'))
    statusCache.value = new Map([['1', post('1', { content: '<p>the fix</p>', editedAt: '2026-04-28T13:00:00Z' })]])
    await settle(el)
    expect($(el, '.status-content')!.textContent).toBe('the fix')
    expect($(el, 'caribou-button.edited')).not.toBeNull()
  })

  it('a hashtag the edit added opens Caribou\'s tag page, from the edited copy\'s tags', async () => {
    signIn()
    const el = await mount(post('1'))
    statusCache.value = new Map([['1', post('1', {
      content: '<p><a href="https://example.social/tags/new" class="mention hashtag" rel="tag">#new</a></p>',
      tags: [{ name: 'new', url: 'https://example.social/tags/new' }], editedAt: '2026-04-28T13:00:00Z',
    })]])
    await settle(el)
    const a = $(el, '.status-content a')!
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    a.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('takes the edit inside a boost too', async () => {
    signIn()
    const el = await mount(post('w', { account: bob, reblog: post('1') }))
    statusCache.value = new Map([['w', post('w', { account: bob, reblog: post('1', { content: '<p>the fix</p>', editedAt: '2026-04-28T13:00:00Z' }) })]])
    await settle(el)
    expect($(el, '.status-content')!.textContent).toBe('the fix')
  })

  it('the history button opens the versions, newest first, sanitized', async () => {
    signIn()
    const history = vi.spyOn(activeClient.value!, 'fetchStatusHistory').mockResolvedValue([
      { content: '<p>teh typo</p>', spoilerText: '', createdAt: '2026-04-28T12:00:00Z', mediaAttachments: [] },
      { content: '<p>the fix<img src=x onerror="alert(1)"></p>', spoilerText: 'cw', createdAt: '2026-04-28T13:00:00Z', mediaAttachments: [] },
    ] as unknown as mastodon.v1.StatusEdit[])
    const el = await mount(post('1', { editedAt: '2026-04-28T13:00:00Z' }))
    $(el, 'caribou-button.edited')!.click()
    await settle(el)
    expect(history).toHaveBeenCalledWith('1')
    const dlg = document.querySelector<CaribouStatusHistory>('caribou-status-history')!
    await dlg.updateComplete
    const items = [...dlg.shadowRoot!.querySelectorAll('li')]
    expect(items.map((li) => li.querySelector('strong')!.textContent)).toEqual(['Current version', 'Original'])
    expect(items[0]!.querySelector('.content')!.textContent).toBe('the fix')
    expect(items[0]!.querySelector('.spoiler')!.textContent).toBe('cw')
    expect(dlg.shadowRoot!.innerHTML).not.toContain('onerror')
    dlg.shadowRoot!.querySelector<HTMLElement>('caribou-button.close')!.click()
    await settle(el)
    expect(document.querySelector('caribou-status-history')).toBeNull()
  })

  it('the history dialog says so when it cannot load', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'fetchStatusHistory').mockRejectedValue(new Error('x'))
    const el = await mount(post('1', { editedAt: '2026-04-28T13:00:00Z' }))
    $(el, 'caribou-button.edited')!.click()
    await settle(el)
    const dlg = document.querySelector<CaribouStatusHistory>('caribou-status-history')!
    await dlg.updateComplete
    expect(dlg.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe('Could not load the edit history.')
  })

  it('the history dialog closes on an account change and drops a late answer', async () => {
    signIn()
    let resolve!: (v: mastodon.v1.StatusEdit[]) => void
    vi.spyOn(activeClient.value!, 'fetchStatusHistory').mockReturnValue(new Promise((r) => { resolve = r }))
    const el = await mount(post('1', { editedAt: '2026-04-28T13:00:00Z' }))
    $(el, 'caribou-button.edited')!.click()
    await settle(el)
    expect(document.querySelector('caribou-status-history')).not.toBeNull()
    const dlg = document.querySelector<CaribouStatusHistory>('caribou-status-history')!
    activeUserKey.value = null
    await settle(el)
    expect(document.querySelector('caribou-status-history')).toBeNull()
    resolve([{ content: '<p>late</p>', spoilerText: '', createdAt: '2026-04-28T12:00:00Z' } as unknown as mastodon.v1.StatusEdit])
    await settle(el)
    expect(dlg.versions).toBeNull()
  })

  it('the history list keeps list semantics, and focus goes back to the mark on close', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'fetchStatusHistory').mockResolvedValue([
      { content: '<p>a</p>', spoilerText: '', createdAt: '2026-04-28T12:00:00Z', mediaAttachments: [] },
    ] as unknown as mastodon.v1.StatusEdit[])
    const el = await mount(post('1', { editedAt: '2026-04-28T13:00:00Z' }))
    const mark = $(el, 'caribou-button.edited')!
    // happy-dom ignores delegatesFocus, so focus the inner button as a
    // browser would; own-posts.spec.ts checks it for real.
    mark.shadowRoot!.querySelector('button')!.focus()
    mark.click()
    await settle(el)
    const dlg = document.querySelector<CaribouStatusHistory>('caribou-status-history')!
    await dlg.updateComplete
    expect(dlg.shadowRoot!.querySelector('ol')!.getAttribute('role')).toBe('list')
    dlg.shadowRoot!.querySelector<HTMLElement>('caribou-button.close')!.click()
    await settle(el)
    expect(el.shadowRoot!.activeElement).toBe(mark)
  })
})
