import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  accountListIds, accountListsCache, createList, deleteList, listById, listMembers, listMembersCache,
  listsCache, loadAccountLists, loadList, loadListMembers, loadLists, setListMember, updateList, userLists,
} from '../lists.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey
const OTHER = 'bob@example.social' as UserKey

const list = (id: string, title: string, patch: Partial<mastodon.v1.List> = {}) =>
  ({ id, title, repliesPolicy: 'list', exclusive: false, ...patch }) as mastodon.v1.List
const account = (id: string) => ({ id, acct: `user${id}`, username: `user${id}` }) as mastodon.v1.Account

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeClient(over: Partial<CaribouClient> = {}, userKey: UserKey = ME): CaribouClient {
  return {
    userKey,
    fetchLists: vi.fn(async () => [list('1', 'Friends'), list('2', 'News')]),
    fetchList: vi.fn(async (id: string) => list(id, `List ${id}`)),
    createList: vi.fn(async (input: { title: string }) => list('9', input.title)),
    updateList: vi.fn(async (id: string, input: { title: string }) => list(id, input.title)),
    deleteList: vi.fn(async () => undefined),
    fetchListAccounts: vi.fn(async () => [account('7'), account('8')]),
    addListAccounts: vi.fn(async () => undefined),
    removeListAccounts: vi.fn(async () => undefined),
    fetchAccountLists: vi.fn(async () => [list('1', 'Friends')]),
    ...over,
  } as unknown as CaribouClient
}

const fail = () => Promise.reject(new CaribouError('server_error', 'boom'))

let toasts: { kind: string; message: string }[]
const onToast = (e: Event) => toasts.push((e as CustomEvent).detail)

beforeEach(() => {
  listsCache.value = new Map()
  listMembersCache.value = new Map()
  accountListsCache.value = new Map()
  activeUserKey.value = ME
  toasts = []
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  activeUserKey.value = null
})

describe('loadLists', () => {
  it('keeps the lists by account', async () => {
    const client = fakeClient()
    await loadLists({ clientSource: () => client })
    expect(userLists()?.map((l) => l.title)).toEqual(['Friends', 'News'])
    expect(userLists(OTHER)).toBeUndefined()
    expect(listById('2')?.title).toBe('News')
  })

  it('throws a failure, and keeps what was known', async () => {
    const ok = fakeClient()
    await loadLists({ clientSource: () => ok })
    const bad = fakeClient({ fetchLists: vi.fn(fail) })
    await expect(loadLists({ clientSource: () => bad })).rejects.toMatchObject({ code: 'server_error' })
    expect(userLists()?.length).toBe(2)
  })

  it('drops an answer that arrives after the account changed', async () => {
    const d = deferred<mastodon.v1.List[]>()
    const client = fakeClient({ fetchLists: vi.fn(() => d.promise) })
    const p = loadLists({ clientSource: () => client })
    activeUserKey.value = OTHER
    d.resolve([list('1', 'Friends')])
    await p
    expect(listsCache.value.size).toBe(0)
  })

  it('drops a failure after the account changed: no throw', async () => {
    const d = deferred<mastodon.v1.List[]>()
    const client = fakeClient({ fetchLists: vi.fn(() => d.promise) })
    const p = loadLists({ clientSource: () => client })
    activeUserKey.value = OTHER
    d.reject(new CaribouError('server_error', 'boom'))
    await expect(p).resolves.toBeUndefined()
  })

  it('drops a read that overlapped a write', async () => {
    const client = fakeClient()
    await loadLists({ clientSource: () => client })
    const read = deferred<mastodon.v1.List[]>()
    const slow = fakeClient({ fetchLists: vi.fn(() => read.promise) })
    const p = loadLists({ clientSource: () => slow })
    await updateList('1', { title: 'Family' }, { clientSource: () => client })
    read.resolve([list('1', 'Friends'), list('2', 'News')])
    await p
    expect(listById('1')?.title).toBe('Family')
  })
})

describe('loadList', () => {
  it('adds one list to the known ones, or replaces it', async () => {
    const client = fakeClient()
    await loadLists({ clientSource: () => client })
    await loadList('2', { clientSource: () => fakeClient({ fetchList: vi.fn(async () => list('2', 'Renamed')) }) })
    await loadList('5', { clientSource: () => client })
    expect(userLists()?.map((l) => l.title)).toEqual(['Friends', 'Renamed', 'List 5'])
  })
})

describe('createList', () => {
  it('adds the new list at the end', async () => {
    const client = fakeClient()
    await loadLists({ clientSource: () => client })
    const made = await createList({ title: 'Cats' }, { clientSource: () => client })
    expect(made?.id).toBe('9')
    expect(userLists()?.map((l) => l.title)).toEqual(['Friends', 'News', 'Cats'])
  })

  it('says so when it fails, and adds nothing', async () => {
    const client = fakeClient({ createList: vi.fn(fail) })
    await loadLists({ clientSource: () => fakeClient() })
    expect(await createList({ title: 'Cats' }, { clientSource: () => client })).toBeNull()
    expect(userLists()?.length).toBe(2)
    expect(toasts).toEqual([{ kind: 'error', message: 'Couldn\'t create the list "Cats".' }])
  })

  it('a list made for an earlier account does not land in the new one', async () => {
    const d = deferred<mastodon.v1.List>()
    const client = fakeClient({ createList: vi.fn(() => d.promise) })
    const p = createList({ title: 'Cats' }, { clientSource: () => client })
    activeUserKey.value = OTHER
    d.resolve(list('9', 'Cats'))
    expect(await p).toBeNull()
    expect(userLists(OTHER)).toBeUndefined()
    expect(toasts).toEqual([])
  })
})

describe('updateList', () => {
  it('renames at once and takes the server\'s copy', async () => {
    const d = deferred<mastodon.v1.List>()
    const client = fakeClient({ updateList: vi.fn(() => d.promise) })
    await loadLists({ clientSource: () => fakeClient() })
    const p = updateList('1', { title: 'Family', repliesPolicy: 'none' }, { clientSource: () => client })
    expect(listById('1')).toMatchObject({ title: 'Family', repliesPolicy: 'none' })
    d.resolve(list('1', 'Family', { repliesPolicy: 'none', exclusive: true }))
    expect(await p).toBe(true)
    expect(listById('1')?.exclusive).toBe(true)
  })

  it('puts the old name back and says so when it fails', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    const client = fakeClient({ updateList: vi.fn(fail) })
    expect(await updateList('1', { title: 'Family' }, { clientSource: () => client })).toBe(false)
    expect(listById('1')?.title).toBe('Friends')
    expect(toasts).toEqual([{ kind: 'error', message: 'Couldn\'t save the list "Family".' }])
  })
})

describe('deleteList', () => {
  it('removes the list at once', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    expect(await deleteList('1', { clientSource: () => fakeClient() })).toBe(true)
    expect(userLists()?.map((l) => l.id)).toEqual(['2'])
  })

  it('puts it back in its place when it fails', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    expect(await deleteList('1', { clientSource: () => fakeClient({ deleteList: vi.fn(fail) }) })).toBe(false)
    expect(userLists()?.map((l) => l.id)).toEqual(['1', '2'])
    expect(toasts).toEqual([{ kind: 'error', message: 'Couldn\'t delete the list "Friends".' }])
  })

  it('a failure after an account change rolls back with no toast', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    const d = deferred<void>()
    const p = deleteList('1', { clientSource: () => fakeClient({ deleteList: vi.fn(() => d.promise) }) })
    activeUserKey.value = OTHER
    d.reject(new CaribouError('server_error', 'boom'))
    expect(await p).toBe(false)
    expect(userLists(ME)?.map((l) => l.id)).toEqual(['1', '2'])
    expect(toasts).toEqual([])
  })
})

describe('members', () => {
  it('loadListMembers keeps the members of a list', async () => {
    await loadListMembers('1', { clientSource: () => fakeClient() })
    expect(listMembers('1')?.map((a) => a.id)).toEqual(['7', '8'])
  })

  it('loadAccountLists keeps which lists hold an account', async () => {
    await loadAccountLists('7', { clientSource: () => fakeClient() })
    expect(accountListIds('7')).toEqual(['1'])
  })

  it('removing a member changes both views at once', async () => {
    const client = fakeClient()
    await loadListMembers('1', { clientSource: () => client })
    await loadAccountLists('7', { clientSource: () => client })
    const d = deferred<void>()
    const slow = fakeClient({ removeListAccounts: vi.fn(() => d.promise) })
    const p = setListMember('1', account('7'), false, { clientSource: () => slow })
    expect(listMembers('1')?.map((a) => a.id)).toEqual(['8'])
    expect(accountListIds('7')).toEqual([])
    d.resolve()
    expect(await p).toBe(true)
    expect(slow.removeListAccounts).toHaveBeenCalledWith('1', ['7'])
  })

  it('adding a member that fails rolls back and says so', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    await loadAccountLists('7', { clientSource: () => fakeClient() })
    const client = fakeClient({ addListAccounts: vi.fn(fail) })
    expect(await setListMember('2', account('7'), true, { clientSource: () => client })).toBe(false)
    expect(accountListIds('7')).toEqual(['1'])
    expect(toasts).toEqual([{ kind: 'error', message: 'Couldn\'t add @user7 to the list "News".' }])
  })

  it('a rollback leaves another change to the same account alone', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    await loadAccountLists('7', { clientSource: () => fakeClient() })
    const d = deferred<void>()
    const p = setListMember('2', account('7'), true,
      { clientSource: () => fakeClient({ addListAccounts: vi.fn(() => d.promise) }) })
    await setListMember('1', account('7'), false, { clientSource: () => fakeClient() })
    d.reject(new CaribouError('server_error', 'boom'))
    await p
    expect(accountListIds('7')).toEqual([])
  })

  it('a member list read for an earlier account is dropped', async () => {
    const d = deferred<mastodon.v1.Account[]>()
    const p = loadListMembers('1', { clientSource: () => fakeClient({ fetchListAccounts: vi.fn(() => d.promise) }) })
    activeUserKey.value = OTHER
    d.resolve([account('7')])
    await p
    expect(listMembersCache.value.size).toBe(0)
  })

  it('deleting a list forgets it in every account\'s memberships', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    await loadAccountLists('7', { clientSource: () => fakeClient() })
    await deleteList('1', { clientSource: () => fakeClient() })
    expect(accountListIds('7')).toEqual([])
  })
})
