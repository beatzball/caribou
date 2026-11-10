import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effect } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient, type Account, type List } from '@beatzball/caribou-mastodon-client'
import {
  accountListIds, accountListsCache, createList, deleteList, listById, listMembers, listMembersCache,
  listsCache, loadAccountLists, loadList, loadListMembers, loadLists, setListMember, updateList, userLists,
  _resetListsForTests,
} from '../lists.js'
import { activeUserKey } from '../users.js'

const ME = 'alice@example.social' as UserKey
const OTHER = 'bob@example.social' as UserKey

const list = (id: string, title: string, patch: Partial<List> = {}) =>
  ({ id, title, repliesPolicy: 'list', exclusive: false, ...patch }) as List
const account = (id: string) => ({ id, acct: `user${id}`, username: `user${id}` }) as Account

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
  _resetListsForTests()
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
    const d = deferred<List[]>()
    const client = fakeClient({ fetchLists: vi.fn(() => d.promise) })
    const p = loadLists({ clientSource: () => client })
    activeUserKey.value = OTHER
    d.resolve([list('1', 'Friends')])
    await p
    expect(listsCache.value.size).toBe(0)
  })

  it('drops a failure after the account changed: no throw', async () => {
    const d = deferred<List[]>()
    const client = fakeClient({ fetchLists: vi.fn(() => d.promise) })
    const p = loadLists({ clientSource: () => client })
    activeUserKey.value = OTHER
    d.reject(new CaribouError('server_error', 'boom'))
    await expect(p).resolves.toBeUndefined()
  })

  it('drops a read that overlapped a write', async () => {
    const client = fakeClient()
    await loadLists({ clientSource: () => client })
    const read = deferred<List[]>()
    // The first answer left before the save; a read after it sees the save.
    let reads = 0
    const slow = fakeClient({
      fetchLists: vi.fn(() => (++reads === 1 ? read.promise : Promise.resolve([list('1', 'Family'), list('2', 'News')]))),
    })
    const p = loadLists({ clientSource: () => slow })
    await updateList('1', { title: 'Family' }, { clientSource: () => client })
    read.resolve([list('1', 'Friends'), list('2', 'News')])
    await p
    expect(listById('1')?.title).toBe('Family')
    expect(reads).toBe(2)
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
    const d = deferred<List>()
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
    const d = deferred<List>()
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
    const d = deferred<Account[]>()
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

describe('review round 1: races', () => {
  it('a read that starts and ends inside a pending delete does not bring the list back (codex 2)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    const del = deferred<void>()
    const p = deleteList('1', { clientSource: () => fakeClient({ deleteList: vi.fn(() => del.promise) }) })
    // The server lists the list until its delete is done.
    let deleted = false
    const reader = fakeClient({
      fetchLists: vi.fn(async () => (deleted ? [list('2', 'News')] : [list('1', 'Friends'), list('2', 'News')])),
    })
    const early = loadLists({ clientSource: () => reader })
    await new Promise((r) => setTimeout(r, 0))
    expect(userLists()?.map((l) => l.id)).toEqual(['2'])
    const r = early
    deleted = true
    del.resolve()
    await p
    await r
    expect(userLists()?.map((l) => l.id)).toEqual(['2'])
  })

  it('check then uncheck of one box runs in order and ends unchecked (codex 3)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    await loadAccountLists('7', { clientSource: () => fakeClient({ fetchAccountLists: vi.fn(async () => []) }) })
    const order: string[] = []
    const add = deferred<void>()
    const client = fakeClient({
      addListAccounts: vi.fn(async () => { order.push('add start'); await add.promise; order.push('add end') }),
      removeListAccounts: vi.fn(async () => { order.push('remove') }),
    })
    const a = setListMember('1', account('7'), true, { clientSource: () => client })
    const b = setListMember('1', account('7'), false, { clientSource: () => client })
    expect(accountListIds('7')).toEqual([])
    await Promise.resolve()
    expect(order).toEqual(['add start'])
    add.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['add start', 'add end', 'remove'])
    expect(accountListIds('7')).toEqual([])
  })

  it('a failed earlier toggle does not undo a later one (codex 3)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    await loadAccountLists('7', { clientSource: () => fakeClient({ fetchAccountLists: vi.fn(async () => []) }) })
    const add = deferred<void>()
    const client = fakeClient({ addListAccounts: vi.fn(() => add.promise) })
    const a = setListMember('1', account('7'), true, { clientSource: () => client })
    const b = setListMember('1', account('7'), false, { clientSource: () => client })
    add.reject(new CaribouError('server_error', 'boom'))
    await Promise.all([a, b])
    expect(accountListIds('7')).toEqual([])
    expect(client.removeListAccounts).toHaveBeenCalledTimes(1)
  })

  it('an older failed edit does not overwrite a newer saved one (codex 4)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    const first = deferred<List>()
    let calls = 0
    const client = fakeClient({
      updateList: vi.fn(async (id: string, input: { title: string }) => (++calls === 1 ? first.promise : list(id, input.title))),
    })
    const a = updateList('1', { title: 'Family' }, { clientSource: () => client })
    const b = updateList('1', { title: 'Cats' }, { clientSource: () => client })
    expect(listById('1')?.title).toBe('Cats')
    first.reject(new CaribouError('server_error', 'boom'))
    await Promise.all([a, b])
    expect(listById('1')?.title).toBe('Cats')
  })

  it('a list made during the first read shows up with the others (codex 5, fable 1)', async () => {
    const first = deferred<List[]>()
    let reads = 0
    const client = fakeClient({
      fetchLists: vi.fn(() => (++reads === 1 ? first.promise : Promise.resolve([list('1', 'Friends'), list('9', 'Cats')]))),
    })
    const r = loadLists({ clientSource: () => client })
    await createList({ title: 'Cats' }, { clientSource: () => client })
    first.resolve([list('1', 'Friends')])
    await r
    expect(userLists()?.map((l) => l.title)).toEqual(['Friends', 'Cats'])
  })

  it('a member read that overlaps a delete does not bring the list back (fable 2)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    await loadAccountLists('7', { clientSource: () => fakeClient() })
    const read = deferred<List[]>()
    let reads = 0
    const reader = fakeClient({
      fetchAccountLists: vi.fn(() => (++reads === 1 ? read.promise : Promise.resolve([]))),
    })
    const r = loadAccountLists('7', { clientSource: () => reader })
    await deleteList('1', { clientSource: () => fakeClient() })
    read.resolve([list('1', 'Friends')])
    await r
    expect(accountListIds('7')).toEqual([])
  })

  it('a failed removal puts the member back in its place (fable 3)', async () => {
    await loadListMembers('1', { clientSource: () => fakeClient() })
    await setListMember('1', account('7'), false,
      { clientSource: () => fakeClient({ removeListAccounts: vi.fn(fail) }) })
    expect(listMembers('1')?.map((a) => a.id)).toEqual(['7', '8'])
  })

  it('delete removes the list before the server answers (fable 7)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    const del = deferred<void>()
    const p = deleteList('1', { clientSource: () => fakeClient({ deleteList: vi.fn(() => del.promise) }) })
    expect(userLists()?.map((l) => l.id)).toEqual(['2'])
    del.resolve()
    await p
  })
})

it('an added member goes where `at` says', async () => {
  activeUserKey.value = ME
  listMembersCache.value = new Map()
  await loadListMembers('1', { clientSource: () => fakeClient() })
  await setListMember('1', account('9'), true, { clientSource: () => fakeClient(), at: 1 })
  expect(listMembers('1')?.map((a) => a.id)).toEqual(['7', '9', '8'])
})

describe('review round 2', () => {
  it('a read that keeps crossing writes gives up with an error the page can retry (codex P3)', async () => {
    let fetches = 0
    const client = fakeClient({
      // Every answer crosses a new write, so none can be kept.
      fetchLists: vi.fn(async () => {
        fetches += 1
        await createList({ title: `L${fetches}` }, { clientSource: () => fakeClient() })
        return [list('1', 'Friends')]
      }),
    })
    await expect(loadLists({ clientSource: () => client })).rejects.toMatchObject({ code: 'unknown' })
    expect(fetches).toBe(5)
    expect(userLists()).toBeUndefined()
  })

  it('only the last of several writes puts its answer in the cache (fable 4)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    const second = deferred<List>()
    let calls = 0
    const client = fakeClient({
      updateList: vi.fn(async (id: string, input: { title: string }) =>
        (++calls === 1 ? list(id, input.title) : second.promise)),
    })
    const a = updateList('1', { title: 'Family' }, { clientSource: () => client })
    const b = updateList('1', { title: 'Cats' }, { clientSource: () => client })
    await a
    // The first answer is in, the second is not: the newest intent shows.
    expect(listById('1')?.title).toBe('Cats')
    second.resolve(list('1', 'Cats'))
    await b
    expect(listById('1')?.title).toBe('Cats')
  })

  it('a reset empties the queues, so one stuck write does not hold the next test (fable 3)', async () => {
    await loadLists({ clientSource: () => fakeClient() })
    void deleteList('1', { clientSource: () => fakeClient({ deleteList: vi.fn(() => new Promise<void>(() => {})) }) })
    _resetListsForTests()
    listsCache.value = new Map([[ME, [list('1', 'Friends')]]])
    // With the stuck delete forgotten, a read is free to go.
    await loadLists({ clientSource: () => fakeClient({ fetchLists: vi.fn(async () => [list('1', 'Friends')]) }) })
    expect(listById('1')?.title).toBe('Friends')
  })
})

it('a read that wakes as a new write starts waits for that one too (fable 1)', async () => {
  _resetListsForTests()
  activeUserKey.value = ME
  listsCache.value = new Map()
  await loadLists({ clientSource: () => fakeClient() })
  const gone = new Set<string>()
  const dA = deferred<void>()
  const dB = deferred<void>()
  const server = fakeClient({
    fetchLists: vi.fn(async () => [list('1', 'Friends'), list('2', 'News')].filter((l) => !gone.has(l.id))),
    deleteList: vi.fn((id: string) => (id === '1' ? dA.promise : dB.promise).then(() => { gone.add(id) })),
  })
  const a = deleteList('1', { clientSource: () => server })
  const r = loadLists({ clientSource: () => server })
  // The first delete clears its members right before it ends. A microtask
  // queued then runs after the end but before the waiting read goes on: a
  // second delete starts in that gap.
  let b: Promise<boolean> | undefined
  let armed = false
  const stop = effect(() => {
    void listMembersCache.value
    if (armed && !b) queueMicrotask(() => { b = deleteList('2', { clientSource: () => server }) })
  })
  armed = true
  dA.resolve()
  await a
  stop()
  await new Promise((res) => setTimeout(res, 0))
  expect(userLists()?.map((l) => l.id)).toEqual([])
  dB.resolve()
  await b!
  await r
  expect(userLists()?.map((l) => l.id)).toEqual([])
})

// Bluesky (#195): a write whose outcome is unknown is not shown as done or
// as not done. The change goes back, the toast says so, and the lists are
// read again (README, "Lists").
describe('a write whose outcome is unknown', () => {
  const unknown = () => Promise.reject(Object.assign(new CaribouError('unknown', 'in doubt'), { name: 'BlueskyWriteUnknown' }))

  it('create: says so and reads the lists again, which bring the list', async () => {
    const fetchLists = vi.fn()
      .mockResolvedValueOnce([list('1', 'Friends')])
      .mockResolvedValueOnce([list('1', 'Friends'), list('9', 'Cats')])
    const client = fakeClient({ createList: vi.fn(unknown), fetchLists })
    await loadLists({ clientSource: () => client })
    expect(await createList({ title: 'Cats' }, { clientSource: () => client })).toBeNull()
    expect(toasts.map((t) => t.message)).toEqual(['Could not tell whether the list "Cats" was created. Reload to check.'])
    await vi.waitFor(() => expect(userLists()?.map((l) => l.title)).toEqual(['Friends', 'Cats']))
  })

  it('rename: the old title comes back, then the read brings what the server has', async () => {
    const fetchLists = vi.fn()
      .mockResolvedValueOnce([list('1', 'Friends')])
      .mockResolvedValueOnce([list('1', 'Close friends')])
    const client = fakeClient({ updateList: vi.fn(unknown), fetchLists })
    await loadLists({ clientSource: () => client })
    expect(await updateList('1', { title: 'Close friends' }, { clientSource: () => client })).toBe(false)
    expect(toasts.map((t) => t.message)).toEqual(['Could not tell whether the list "Close friends" was saved. Reload to check.'])
    await vi.waitFor(() => expect(listById('1')?.title).toBe('Close friends'))
  })

  it('delete: says so and reads the lists again', async () => {
    const fetchLists = vi.fn()
      .mockResolvedValueOnce([list('1', 'Friends'), list('2', 'News')])
      .mockResolvedValueOnce([list('2', 'News')])
    const client = fakeClient({ deleteList: vi.fn(unknown), fetchLists })
    await loadLists({ clientSource: () => client })
    expect(await deleteList('1', { clientSource: () => client })).toBe(false)
    expect(toasts.map((t) => t.message)).toEqual(['Could not tell whether the list "Friends" was deleted. Reload to check.'])
    await vi.waitFor(() => expect(userLists()?.map((l) => l.id)).toEqual(['2']))
  })

  it('member: says so and reads the members and the account lists again', async () => {
    const fetchListAccounts = vi.fn()
      .mockResolvedValueOnce([account('7')])
      .mockResolvedValueOnce([account('7'), account('8')])
    const fetchAccountLists = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([list('1', 'Friends')])
    const client = fakeClient({ addListAccounts: vi.fn(unknown), fetchListAccounts, fetchAccountLists })
    await loadLists({ clientSource: () => client })
    await loadListMembers('1', { clientSource: () => client })
    await loadAccountLists('8', { clientSource: () => client })
    expect(await setListMember('1', account('8'), true, { clientSource: () => client })).toBe(false)
    expect(toasts.map((t) => t.message)).toEqual(['Could not tell whether @user8 was added to the list "Friends". Reload to check.'])
    await vi.waitFor(() => expect(listMembers('1')?.map((a) => a.id)).toEqual(['7', '8']))
    await vi.waitFor(() => expect(accountListIds('8')).toEqual(['1']))
  })

  it('a plain failure still says "Couldn\'t" and reads nothing again', async () => {
    const client = fakeClient({ createList: vi.fn(fail) })
    await loadLists({ clientSource: () => client })
    await createList({ title: 'Cats' }, { clientSource: () => client })
    expect(toasts.map((t) => t.message)).toEqual(['Couldn\'t create the list "Cats".'])
    expect(client.fetchLists).toHaveBeenCalledTimes(1)
  })
})

describe('review fix 1', () => {
  const partly = () => Promise.reject(Object.assign(new CaribouError('unknown', 'partly'), {
    name: 'BlueskyListPartlyDeleted',
    userMessage: 'Some members were removed, but the list was not deleted. Delete it again to finish.',
  }))

  it('L2: a partly done delete brings the list back, says so, and reads members and memberships again', async () => {
    const fetchListAccounts = vi.fn()
      .mockResolvedValueOnce([account('7'), account('8')])
      .mockResolvedValueOnce([])
    const fetchAccountLists = vi.fn()
      .mockResolvedValueOnce([list('1', 'Friends')])
      .mockResolvedValueOnce([])
    const client = fakeClient({ deleteList: vi.fn(partly), fetchListAccounts, fetchAccountLists })
    await loadLists({ clientSource: () => client })
    await loadListMembers('1', { clientSource: () => client })
    await loadAccountLists('7', { clientSource: () => client })
    expect(await deleteList('1', { clientSource: () => client })).toBe(false)
    expect(listById('1')?.title).toBe('Friends')
    expect(toasts.map((t) => t.message)).toEqual(['Some members were removed, but the list was not deleted. Delete it again to finish.'])
    // The panel and the picker's boxes show what the server has left.
    await vi.waitFor(() => expect(listMembers('1')).toEqual([]))
    await vi.waitFor(() => expect(accountListIds('7')).toEqual([]))
    expect(client.fetchLists).toHaveBeenCalledTimes(2)
  })

  it('L1: a refusal with words for the reader is toasted as it is', async () => {
    const tooLarge = () => Promise.reject(Object.assign(new CaribouError('unknown', 'x'),
      { userMessage: 'This list is too large to change here. Use bsky.app.' }))
    const client = fakeClient({ deleteList: vi.fn(tooLarge), removeListAccounts: vi.fn(tooLarge) })
    await loadLists({ clientSource: () => client })
    await deleteList('1', { clientSource: () => client })
    await setListMember('2', account('7'), false, { clientSource: () => client })
    expect(toasts.map((t) => t.message)).toEqual([
      'This list is too large to change here. Use bsky.app.',
      'This list is too large to change here. Use bsky.app.',
    ])
    expect(listById('1')?.title).toBe('Friends')
  })

  it('an unknown delete reads the members and memberships again too', async () => {
    const unknown = () => Promise.reject(Object.assign(new CaribouError('unknown', 'in doubt'), { name: 'BlueskyWriteUnknown' }))
    const fetchListAccounts = vi.fn().mockResolvedValueOnce([account('7')]).mockResolvedValueOnce([])
    const client = fakeClient({ deleteList: vi.fn(unknown), fetchListAccounts })
    await loadLists({ clientSource: () => client })
    await loadListMembers('1', { clientSource: () => client })
    await deleteList('1', { clientSource: () => client })
    await vi.waitFor(() => expect(listMembers('1')).toEqual([]))
  })
})
