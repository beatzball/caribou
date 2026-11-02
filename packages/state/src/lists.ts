import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, ListInput } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { activeClient, activeUserKey } from './users.js'
import { ownerGeneration } from './keep-alive.js'

// The reader's lists (#51). Every entry is keyed by the account that read
// it, so one account never sees another's lists. Treat the signals as
// read-only — write through the functions here.

/** Each account's lists, in the server's order. */
export const listsCache = signal<Map<UserKey, mastodon.v1.List[]>>(new Map())
/** The members of each list, keyed by `listKey`. */
export const listMembersCache = signal<Map<string, mastodon.v1.Account[]>>(new Map())
/** The ids of the lists that hold each account, keyed by `listKey`. */
export const accountListsCache = signal<Map<string, string[]>>(new Map())

export const listKey = (userKey: UserKey, id: string) => `${userKey} ${id}`

export function userLists(userKey: UserKey | null = activeUserKey.value): mastodon.v1.List[] | undefined {
  return userKey ? listsCache.value.get(userKey) : undefined
}

export function listById(id: string, userKey: UserKey | null = activeUserKey.value): mastodon.v1.List | undefined {
  return userLists(userKey)?.find((l) => l.id === id)
}

export function listMembers(id: string, userKey: UserKey | null = activeUserKey.value): mastodon.v1.Account[] | undefined {
  return userKey ? listMembersCache.value.get(listKey(userKey, id)) : undefined
}

/** The ids of the reader's lists that hold the account; undefined while not known. */
export function accountListIds(accountId: string, userKey: UserKey | null = activeUserKey.value): string[] | undefined {
  return userKey ? accountListsCache.value.get(listKey(userKey, accountId)) : undefined
}

export interface ListsOpts {
  clientSource?: () => CaribouClient | null
}

const defaultSource = () => activeClient.value

function toast(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind: 'error', message } }))
}

const named = (list: mastodon.v1.List | undefined) => (list ? `the list "${list.title}"` : 'the list')

// A read that overlaps a write carries older state and is dropped. The
// revision of a key is bumped when a write starts and again when it ends.
const revisions = new Map<string, number>()
const bump = (key: string) => revisions.set(key, (revisions.get(key) ?? 0) + 1)
const revision = (key: string) => revisions.get(key) ?? 0

function setIn<K, V>(sig: { value: Map<K, V> }, key: K, value: V | undefined): void {
  const next = new Map(sig.value)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  sig.value = next
}

function putLists(userKey: UserKey, fn: (lists: mastodon.v1.List[]) => mastodon.v1.List[]): void {
  const current = listsCache.value.get(userKey)
  if (!current) return
  setIn(listsCache, userKey, fn(current))
}

// Each request reads the owner generation first and checks it again before
// it writes or says anything (`ownerGeneration()` in keep-alive.ts): a slow
// answer for an earlier account never lands in the new one, even after a
// switch and back. A read that fails for the current account throws, so the
// page can show its error; one for an earlier account resolves quietly.

async function read<T>(
  opts: ListsOpts, key: (client: CaribouClient) => string,
  fetch: (client: CaribouClient) => Promise<T>, store: (client: CaribouClient, value: T) => void,
): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const generation = ownerGeneration()
  const k = key(client)
  const rev = revision(k)
  let value: T
  try {
    value = await fetch(client)
  } catch (err) {
    if (generation !== ownerGeneration()) return
    throw err
  }
  if (generation !== ownerGeneration() || revision(k) !== rev) return
  store(client, value)
}

export function loadLists(opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => c.userKey, (c) => c.fetchLists(), (c, lists) => {
    setIn(listsCache, c.userKey, lists)
  })
}

/** Reads one list, for a page opened at its address; it joins the known ones. */
export function loadList(id: string, opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => c.userKey, (c) => c.fetchList(id), (c, list) => {
    const lists = listsCache.value.get(c.userKey) ?? []
    const at = lists.findIndex((l) => l.id === list.id)
    setIn(listsCache, c.userKey, at < 0 ? [...lists, list] : lists.map((l, i) => (i === at ? list : l)))
  })
}

export function loadListMembers(id: string, opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => listKey(c.userKey, `members ${id}`), (c) => c.fetchListAccounts(id), (c, accounts) => {
    setIn(listMembersCache, listKey(c.userKey, id), accounts)
  })
}

export function loadAccountLists(accountId: string, opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => listKey(c.userKey, `account ${accountId}`), (c) => c.fetchAccountLists(accountId),
    (c, lists) => { setIn(accountListsCache, listKey(c.userKey, accountId), lists.map((l) => l.id)) })
}

/** Makes a list. Resolves to it, or to null when it failed (a toast says so). */
export async function createList(input: ListInput, opts: ListsOpts = {}): Promise<mastodon.v1.List | null> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return null
  const generation = ownerGeneration()
  bump(client.userKey)
  try {
    const made = await client.createList(input)
    if (generation !== ownerGeneration()) return null
    const lists = listsCache.value.get(client.userKey)
    if (lists && !lists.some((l) => l.id === made.id)) setIn(listsCache, client.userKey, [...lists, made])
    return made
  } catch {
    if (generation === ownerGeneration()) toast(`Couldn't create the list "${input.title}".`)
    return null
  } finally {
    bump(client.userKey)
  }
}

/** Saves a list's fields. The change shows at once and goes back on a failure. */
export async function updateList(id: string, input: ListInput, opts: ListsOpts = {}): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return false
  const generation = ownerGeneration()
  const before = listById(id, client.userKey)
  const patch = { title: input.title,
    ...(input.repliesPolicy ? { repliesPolicy: input.repliesPolicy } : {}),
    ...(input.exclusive !== undefined ? { exclusive: input.exclusive } : {}) }
  putLists(client.userKey, (lists) => lists.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  bump(client.userKey)
  try {
    const saved = await client.updateList(id, input)
    if (generation === ownerGeneration()) putLists(client.userKey, (lists) => lists.map((l) => (l.id === id ? saved : l)))
    return true
  } catch {
    // Keyed by account, so the old account's copy goes back even after a
    // switch; only the toast is for the account that is still active.
    if (before) putLists(client.userKey, (lists) => lists.map((l) => (l.id === id ? before : l)))
    if (generation === ownerGeneration()) toast(`Couldn't save the list "${input.title}".`)
    return false
  } finally {
    bump(client.userKey)
  }
}

/** Deletes a list. It goes at once and comes back in its place on a failure. */
export async function deleteList(id: string, opts: ListsOpts = {}): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return false
  const generation = ownerGeneration()
  const lists = listsCache.value.get(client.userKey)
  const at = lists?.findIndex((l) => l.id === id) ?? -1
  const before = at >= 0 ? lists![at] : undefined
  putLists(client.userKey, (ls) => ls.filter((l) => l.id !== id))
  bump(client.userKey)
  try {
    await client.deleteList(id)
    // The list is gone for every account it held.
    const prefix = `${client.userKey} `
    const next = new Map(accountListsCache.value)
    for (const [k, ids] of next) if (k.startsWith(prefix) && ids.includes(id)) next.set(k, ids.filter((x) => x !== id))
    accountListsCache.value = next
    setIn(listMembersCache, listKey(client.userKey, id), undefined)
    return true
  } catch {
    if (before) putLists(client.userKey, (ls) => (ls.some((l) => l.id === id) ? ls : [...ls.slice(0, at), before, ...ls.slice(at)]))
    if (generation === ownerGeneration()) toast(`Couldn't delete ${named(before)}.`)
    return false
  } finally {
    bump(client.userKey)
  }
}

// Adds or removes the account in what is known: the list's members and the
// account's lists. A rollback is the opposite change, so another change made
// meanwhile (to another list, or another account) stays.
function applyMember(userKey: UserKey, listId: string, account: mastodon.v1.Account, member: boolean): void {
  const mKey = listKey(userKey, listId)
  const members = listMembersCache.value.get(mKey)
  if (members) {
    const without = members.filter((a) => a.id !== account.id)
    setIn(listMembersCache, mKey, member ? [...without, account] : without)
  }
  const aKey = listKey(userKey, account.id)
  const ids = accountListsCache.value.get(aKey)
  if (ids) {
    const without = ids.filter((x) => x !== listId)
    setIn(accountListsCache, aKey, member ? [...without, listId] : without)
  }
}

/**
 * Adds the account to the list, or removes it. The change shows at once; a
 * failure puts it back and says so. The server adds only an account the
 * reader follows.
 */
export async function setListMember(
  listId: string, account: mastodon.v1.Account, member: boolean, opts: ListsOpts = {},
): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return false
  const generation = ownerGeneration()
  const keys = [listKey(client.userKey, `members ${listId}`), listKey(client.userKey, `account ${account.id}`)]
  applyMember(client.userKey, listId, account, member)
  keys.forEach(bump)
  try {
    if (member) await client.addListAccounts(listId, [account.id])
    else await client.removeListAccounts(listId, [account.id])
    return true
  } catch {
    applyMember(client.userKey, listId, account, !member)
    if (generation === ownerGeneration()) {
      const title = named(listById(listId, client.userKey))
      toast(member ? `Couldn't add @${account.acct} to ${title}.` : `Couldn't remove @${account.acct} from ${title}.`)
    }
    return false
  } finally {
    keys.forEach(bump)
  }
}
