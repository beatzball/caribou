import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import { toUserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  accountListsCache, activeClient, activeUserKey, addUserSession, listMembersCache, listsCache, users,
} from '@beatzball/caribou-state'
import '../caribou-lists.js'
import '../caribou-list-header.js'
import type { CaribouLists } from '../caribou-lists.js'
import type { CaribouListHeader } from '../caribou-list-header.js'
import { listDialog, type CaribouListDialog } from '../caribou-list-dialog.js'
import { openListPicker, type CaribouListPicker } from '../caribou-list-picker.js'
import { listPath, parseListId } from '../_list-path.js'

const list = (id: string, title: string, patch: Partial<mastodon.v1.List> = {}) =>
  ({ id, title, repliesPolicy: 'list', exclusive: false, ...patch }) as mastodon.v1.List
const account = (id: string, acct: string) =>
  ({ id, acct, username: acct, displayName: acct.toUpperCase(), avatar: '', avatarStatic: '' }) as mastodon.v1.Account

function signIn(name = 'alice'): CaribouClient {
  addUserSession({
    userKey: toUserKey(name, 'example.social'), server: 'example.social', token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: name, username: name } as mastodon.v1.Account,
  })
  return activeClient.value!
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function settle(el: Element & { updateComplete: Promise<boolean> }) {
  for (let i = 0; i < 4; i++) {
    await flush()
    while (!(await el.updateComplete)) { /* until no update is pending */ }
  }
}

async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(tag: string, set?: (el: T) => void): Promise<T> {
  const el = document.createElement(tag) as T
  set?.(el)
  document.body.appendChild(el)
  await settle(el)
  return el
}

async function dialogOf<T extends HTMLElement & { updateComplete: Promise<boolean> }>(tag: string): Promise<T> {
  await flush()
  const el = document.querySelector(tag) as T
  await el.updateComplete
  return el
}

const $ = (el: Element, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)
const $$ = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)]

let toasts: string[]
const onToast = (e: Event) => toasts.push((e as CustomEvent<{ message: string }>).detail.message)

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  document.body.replaceChildren()
  users.value = new Map()
  activeUserKey.value = null
  listsCache.value = new Map()
  listMembersCache.value = new Map()
  accountListsCache.value = new Map()
  localStorage.clear()
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('list paths', () => {
  it('accepts ids a server mints and refuses anything that could leave the path', () => {
    expect(parseListId('123')).toBe('123')
    expect(parseListId('ab_C-9')).toBe('ab_C-9')
    for (const bad of ['', '..', '1%2F2', 'a b', '1.2', '%E0%A4%A', 'x'.repeat(65)]) expect(parseListId(bad)).toBeNull()
    expect(listPath('12')).toBe('/lists/12')
  })
})

describe('<caribou-list-dialog>', () => {
  it('asks for a title, a replies policy and, where the server has it, exclusive', async () => {
    const answer = listDialog({ title: 'New list', submitLabel: 'Create', exclusive: true })
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    expect($(el, 'h2')!.textContent).toBe('New list')
    expect(el.shadowRoot!.activeElement).toBe($(el, '#title'))
    const title = $(el, '#title') as HTMLInputElement
    title.value = '  Cats  '
    title.dispatchEvent(new Event('input'))
    ;($(el, 'input[value="none"]') as HTMLInputElement).click()
    ;($(el, '#exclusive') as HTMLInputElement).click()
    $(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await answer).toEqual({ title: 'Cats', repliesPolicy: 'none', exclusive: true })
    expect(document.querySelector('caribou-list-dialog')).toBeNull()
  })

  it('keeps an empty title from being sent, and says why', async () => {
    const answer = listDialog({ title: 'New list', submitLabel: 'Create', exclusive: false })
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    expect($(el, '#exclusive')).toBeNull()
    $(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await el.updateComplete
    expect($(el, '#title')!.getAttribute('aria-invalid')).toBe('true')
    expect($(el, '#title-error')!.textContent).toBe('Give the list a title.')
    $(el, 'caribou-button.cancel')!.click()
    expect(await answer).toBeNull()
  })

  it('starts from the list it edits', async () => {
    const answer = listDialog({
      title: 'Edit list', submitLabel: 'Save', exclusive: false,
      initial: { title: 'Friends', repliesPolicy: 'followed' },
    })
    const el = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    expect(($(el, '#title') as HTMLInputElement).value).toBe('Friends')
    expect(($(el, 'input[value="followed"]') as HTMLInputElement).checked).toBe(true)
    $(el, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await answer).toEqual({ title: 'Friends', repliesPolicy: 'followed' })
  })

  it('closes with null when the active account changes', async () => {
    signIn()
    const answer = listDialog({ title: 'New list', submitLabel: 'Create', exclusive: false })
    await dialogOf<CaribouListDialog>('caribou-list-dialog')
    activeUserKey.value = null
    expect(await answer).toBeNull()
  })
})

describe('<caribou-lists>', () => {
  it('lists the reader\'s lists as links to their timelines', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([list('1', 'Friends'), list('2', 'News')])
    const el = await mount<CaribouLists>('caribou-lists')
    expect($(el, 'h1')!.textContent).toBe('Lists')
    const links = $$(el, 'li a.title')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Friends', '/lists/1'], ['News', '/lists/2']])
    expect($(el, 'li caribou-button.edit')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Edit Friends')
  })

  it('says when there are no lists', async () => {
    vi.spyOn(signIn(), 'fetchLists').mockResolvedValue([])
    const el = await mount<CaribouLists>('caribou-lists')
    expect($(el, '.notice')!.textContent).toContain('No lists yet.')
  })

  it('shows a failed read with Retry, and Retry reads again', async () => {
    const client = signIn()
    const fetch = vi.spyOn(client, 'fetchLists').mockRejectedValueOnce(new CaribouError('server_error', 'Server down'))
      .mockResolvedValueOnce([list('1', 'Friends')])
    const el = await mount<CaribouLists>('caribou-lists')
    expect($(el, '[role="alert"]')!.textContent).toBe('Server down')
    $(el, '.failed caribou-button')!.click()
    await settle(el)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect($$(el, 'li a.title').map((a) => a.textContent)).toEqual(['Friends'])
  })

  it('New list makes a list and focuses its link', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([list('1', 'Friends')])
    const create = vi.spyOn(client, 'createList').mockResolvedValue(list('9', 'Cats'))
    const el = await mount<CaribouLists>('caribou-lists')
    $(el, 'caribou-button.new')!.click()
    const d = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    const title = $(d, '#title') as HTMLInputElement
    title.value = 'Cats'
    title.dispatchEvent(new Event('input'))
    $(d, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle(el)
    expect(create).toHaveBeenCalledWith({ title: 'Cats', repliesPolicy: 'list', exclusive: false })
    expect($$(el, 'li a.title').map((a) => a.textContent)).toEqual(['Friends', 'Cats'])
    expect(el.shadowRoot!.activeElement).toBe($(el, 'li[data-list-id="9"] a.title'))
  })

  it('Edit renames the list in place', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([list('1', 'Friends')])
    const update = vi.spyOn(client, 'updateList').mockResolvedValue(list('1', 'Family'))
    const el = await mount<CaribouLists>('caribou-lists')
    $(el, 'li caribou-button.edit')!.click()
    const d = await dialogOf<CaribouListDialog>('caribou-list-dialog')
    const title = $(d, '#title') as HTMLInputElement
    title.value = 'Family'
    title.dispatchEvent(new Event('input'))
    $(d, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle(el)
    expect(update).toHaveBeenCalledWith('1', { title: 'Family', repliesPolicy: 'list', exclusive: false })
    expect($$(el, 'li a.title').map((a) => a.textContent)).toEqual(['Family'])
  })

  it('Delete asks first, then removes the row; a failure brings it back with a toast', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([list('1', 'Friends'), list('2', 'News')])
    const del = vi.spyOn(client, 'deleteList').mockRejectedValue(new CaribouError('server_error', 'boom'))
    const el = await mount<CaribouLists>('caribou-lists')
    $(el, 'li caribou-button.delete')!.click()
    await flush()
    const confirm = document.querySelector('caribou-confirm-dialog')!
    await confirm.updateComplete
    expect(confirm.shadowRoot!.querySelector('h2')!.textContent).toBe('Delete "Friends"?')
    ;(confirm.shadowRoot!.querySelector('caribou-button.confirm') as HTMLElement).click()
    await settle(el)
    expect(del).toHaveBeenCalledWith('1')
    expect($$(el, 'li a.title').map((a) => a.textContent)).toEqual(['Friends', 'News'])
    expect(toasts).toEqual(['Couldn\'t delete the list "Friends".'])
  })
})

describe('<caribou-list-header>', () => {
  it('shows the list\'s title and its members, with Remove', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchList').mockResolvedValue(list('3', 'Friends'))
    vi.spyOn(client, 'fetchListAccounts').mockResolvedValue([account('7', 'bob'), account('8', 'carol')])
    const remove = vi.spyOn(client, 'removeListAccounts').mockResolvedValue()
    const el = await mount<CaribouListHeader>('caribou-list-header', (e) => { e.list = '3' })
    expect($(el, 'h1')!.textContent).toBe('Friends')
    const toggle = $(el, 'button.members')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('members')
    toggle.click()
    await settle(el)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect($$(el, '#members .who').map((a) => [a.querySelector('span')!.textContent, a.getAttribute('href')]))
      .toEqual([['@bob', '/@bob@example.social'], ['@carol', '/@carol@example.social']])
    $(el, '#members li caribou-button.remove')!.click()
    await settle(el)
    expect(remove).toHaveBeenCalledWith('3', ['7'])
    expect($$(el, '#members li').map((li) => li.dataset.accountId)).toEqual(['8'])
    expect(el.shadowRoot!.activeElement).toBe($(el, '#members li caribou-button.remove'))
  })

  it('a failed removal puts the member back and says so', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchList').mockResolvedValue(list('3', 'Friends'))
    vi.spyOn(client, 'fetchListAccounts').mockResolvedValue([account('7', 'bob')])
    vi.spyOn(client, 'removeListAccounts').mockRejectedValue(new CaribouError('server_error', 'boom'))
    const el = await mount<CaribouListHeader>('caribou-list-header', (e) => { e.list = '3' })
    $(el, 'button.members')!.click()
    await settle(el)
    $(el, '#members li caribou-button.remove')!.click()
    await settle(el)
    expect($$(el, '#members li').map((li) => li.dataset.accountId)).toEqual(['7'])
    expect(toasts).toEqual(['Couldn\'t remove @bob from the list "Friends".'])
  })

  it('says when the list does not exist', async () => {
    vi.spyOn(signIn(), 'fetchList').mockRejectedValue(new CaribouError('not_found', 'Record not found'))
    const el = await mount<CaribouListHeader>('caribou-list-header', (e) => { e.list = '3' })
    expect($(el, 'h1')!.textContent).toBe('This list does not exist.')
    expect($(el, 'button.members')).toBeNull()
  })
})

describe('openListPicker', () => {
  it('checks the lists that hold the account, and adds or removes it at once', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([list('1', 'Friends'), list('2', 'News')])
    vi.spyOn(client, 'fetchAccountLists').mockResolvedValue([list('1', 'Friends')])
    const add = vi.spyOn(client, 'addListAccounts').mockResolvedValue()
    const remove = vi.spyOn(client, 'removeListAccounts').mockResolvedValue()
    const closed = openListPicker(account('7', 'bob'), true)
    const el = await dialogOf<CaribouListPicker>('caribou-list-picker')
    await settle(el)
    expect($(el, 'h2')!.textContent).toBe('Lists for @bob')
    expect($(el, '#hint')).toBeNull()
    const boxes = $$(el, 'input[type="checkbox"]') as HTMLInputElement[]
    expect(boxes.map((b) => [b.dataset.listId, b.checked])).toEqual([['1', true], ['2', false]])
    boxes[1]!.click()
    boxes[0]!.click()
    await settle(el)
    expect(add).toHaveBeenCalledWith('2', ['7'])
    expect(remove).toHaveBeenCalledWith('1', ['7'])
    $(el, 'caribou-button.done')!.click()
    await closed
    expect(document.querySelector('caribou-list-picker')).toBeNull()
  })

  it('a failed add unchecks the box and says why', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([list('1', 'Friends')])
    vi.spyOn(client, 'fetchAccountLists').mockResolvedValue([])
    vi.spyOn(client, 'addListAccounts').mockRejectedValue(new CaribouError('not_found', 'Record not found'))
    void openListPicker(account('7', 'bob'), false)
    const el = await dialogOf<CaribouListPicker>('caribou-list-picker')
    await settle(el)
    expect($(el, '#hint')!.textContent).toBe('Only accounts you follow can be added to a list.')
    const box = $(el, 'input[type="checkbox"]') as HTMLInputElement
    box.click()
    await settle(el)
    expect(box.checked).toBe(false)
    expect(toasts).toEqual(['Couldn\'t add @bob to the list "Friends".'])
  })

  it('closes when the active account changes', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchLists').mockResolvedValue([])
    vi.spyOn(client, 'fetchAccountLists').mockResolvedValue([])
    const closed = openListPicker(account('7', 'bob'), true)
    await dialogOf<CaribouListPicker>('caribou-list-picker')
    activeUserKey.value = null
    await closed
    expect(document.querySelector('caribou-list-picker')).toBeNull()
  })
})
