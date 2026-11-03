import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient, type ListInput } from '@beatzball/caribou-mastodon-client'
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

const named = (list: mastodon.v1.List | undefined) => (list ? `the list "${list.title}"` : 'the list')

// --- Reads and writes that overlap ---------------------------------------
//
// Every write marks the keys it changes as busy from the moment it changes
// the cache (optimistic) until the server has answered. A read waits until
// its keys are idle, and drops its answer and asks again when a write
// started or ended while it was out: an answer that crossed a write may
// hold the state from before it. So a read never undoes a pending write,
// and a dropped read still ends with the server's current state.
//
// Keys: the account (`userKey`) for the lists themselves; every member and
// membership read also waits on it, so a delete keeps a late read from
// bringing its list back. `members <list>` and `account <id>` for the two
// views of one membership.

const pending = new Map<string, number>()
const revisions = new Map<string, number>()
const idleWaiters = new Set<() => void>()
const revision = (key: string) => revisions.get(key) ?? 0
const bump = (key: string) => revisions.set(key, revision(key) + 1)
const busy = (keys: readonly string[]) => keys.some((k) => (pending.get(k) ?? 0) > 0)

function begin(keys: readonly string[]): void {
  for (const k of keys) { pending.set(k, (pending.get(k) ?? 0) + 1); bump(k) }
}

function end(keys: readonly string[]): void {
  for (const k of keys) {
    const n = (pending.get(k) ?? 1) - 1
    if (n > 0) pending.set(k, n)
    else pending.delete(k)
    bump(k)
  }
  for (const wake of [...idleWaiters]) wake()
}

function idle(keys: readonly string[]): Promise<void> {
  if (!busy(keys)) return Promise.resolve()
  return new Promise((resolve) => {
    const wake = () => {
      if (busy(keys)) return
      idleWaiters.delete(wake)
      resolve()
    }
    idleWaiters.add(wake)
  })
}

// Writes to one thing (one list, one membership) run one at a time, in the
// order they were asked for, so the server ends with the last intent.
const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(run, run)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return next
}

const MAX_READ_TRIES = 5

// Each request reads the owner generation first and checks it again before
// it writes or says anything (`ownerGeneration()` in keep-alive.ts): a slow
// answer for an earlier account never lands in the new one, even after a
// switch and back. A read that fails for the current account throws, so the
// page can show its error; one for an earlier account resolves quietly.
async function read<T>(
  opts: ListsOpts, keys: (client: CaribouClient) => string[],
  fetch: (client: CaribouClient) => Promise<T>, store: (client: CaribouClient, value: T) => void,
): Promise<void> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return
  const generation = ownerGeneration()
  const ks = keys(client)
  for (let i = 0; i < MAX_READ_TRIES; i++) {
    // Starts at once when no write is out, so the request goes now. A loop:
    // a write can start between the wake and this check.
    while (busy(ks)) await idle(ks)
    if (generation !== ownerGeneration()) return
    const revs = ks.map(revision)
    let value: T
    try {
      value = await fetch(client)
    } catch (err) {
      if (generation !== ownerGeneration()) return
      throw err
    }
    if (generation !== ownerGeneration()) return
    if (ks.every((k, j) => revision(k) === revs[j])) {
      store(client, value)
      return
    }
  }
  // Every answer crossed a write. Say so, so the page offers Retry instead
  // of waiting for an answer that will not come.
  throw new CaribouError('unknown', 'Your lists changed while they loaded. Try again.')
}

const membersKey = (userKey: UserKey, listId: string) => listKey(userKey, `members ${listId}`)
const accountKey = (userKey: UserKey, accountId: string) => listKey(userKey, `account ${accountId}`)

export function loadLists(opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => [c.userKey], (c) => c.fetchLists(), (c, lists) => {
    setIn(listsCache, c.userKey, lists)
  })
}

/** Reads one list, for a page opened at its address; it joins the known ones. */
export function loadList(id: string, opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => [c.userKey], (c) => c.fetchList(id), (c, list) => {
    const lists = listsCache.value.get(c.userKey) ?? []
    const at = lists.findIndex((l) => l.id === list.id)
    setIn(listsCache, c.userKey, at < 0 ? [...lists, list] : lists.map((l, i) => (i === at ? list : l)))
  })
}

export function loadListMembers(id: string, opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => [c.userKey, membersKey(c.userKey, id)], (c) => c.fetchListAccounts(id), (c, accounts) => {
    setIn(listMembersCache, listKey(c.userKey, id), accounts)
  })
}

export function loadAccountLists(accountId: string, opts: ListsOpts = {}): Promise<void> {
  return read(opts, (c) => [c.userKey, accountKey(c.userKey, accountId)], (c) => c.fetchAccountLists(accountId),
    (c, lists) => { setIn(accountListsCache, listKey(c.userKey, accountId), lists.map((l) => l.id)) })
}

/**
 * Makes a list. Resolves to it, or to null when it failed (a toast says so).
 * A read of the lists that was out meanwhile asks again, so the new list
 * shows with the others even on a first visit.
 */
export async function createList(input: ListInput, opts: ListsOpts = {}): Promise<mastodon.v1.List | null> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return null
  const generation = ownerGeneration()
  begin([client.userKey])
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
    end([client.userKey])
  }
}

// One list's writes: the server's last known copy, and how many writes are
// queued. Only the last write of a run puts its answer (or, on a failure,
// the last known copy) in the cache; until then the newest intent shows.
interface ListWrites { confirmed: mastodon.v1.List | undefined; count: number }
const listWrites = new Map<string, ListWrites>()

function listWritesFor(userKey: UserKey, id: string): ListWrites {
  const key = listKey(userKey, `list ${id}`)
  let w = listWrites.get(key)
  if (!w) {
    w = { confirmed: listById(id, userKey), count: 0 }
    listWrites.set(key, w)
  }
  return w
}

function doneWith(userKey: UserKey, id: string, w: ListWrites): boolean {
  w.count -= 1
  if (w.count > 0) return false
  listWrites.delete(listKey(userKey, `list ${id}`))
  return true
}

/** Saves a list's fields. The change shows at once and goes back on a failure. */
export async function updateList(id: string, input: ListInput, opts: ListsOpts = {}): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return false
  const userKey = client.userKey
  const generation = ownerGeneration()
  const w = listWritesFor(userKey, id)
  w.count += 1
  const patch = { title: input.title,
    ...(input.repliesPolicy ? { repliesPolicy: input.repliesPolicy } : {}),
    ...(input.exclusive !== undefined ? { exclusive: input.exclusive } : {}) }
  putLists(userKey, (lists) => lists.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  begin([userKey])
  return enqueue(listKey(userKey, `list ${id}`), async () => {
    let ok = false
    try {
      w.confirmed = await client.updateList(id, input)
      ok = true
    } catch {
      if (generation === ownerGeneration()) toast(`Couldn't save the list "${input.title}".`)
    }
    // Keyed by account, so the old account's copy is right even after a
    // switch; only the toast is for the account that is still active.
    const last = doneWith(userKey, id, w)
    const settled = w.confirmed
    if (last && settled) putLists(userKey, (lists) => lists.map((l) => (l.id === id ? settled : l)))
    end([userKey])
    return ok
  })
}

/** Deletes a list. It goes at once and comes back in its place on a failure. */
export async function deleteList(id: string, opts: ListsOpts = {}): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return false
  const userKey = client.userKey
  const generation = ownerGeneration()
  const w = listWritesFor(userKey, id)
  w.count += 1
  const lists = listsCache.value.get(userKey)
  const at = lists?.findIndex((l) => l.id === id) ?? -1
  putLists(userKey, (ls) => ls.filter((l) => l.id !== id))
  begin([userKey])
  return enqueue(listKey(userKey, `list ${id}`), async () => {
    let ok = false
    try {
      await client.deleteList(id)
      ok = true
      // The list is gone for every account it held.
      const prefix = `${userKey} `
      const next = new Map(accountListsCache.value)
      for (const [k, ids] of next) if (k.startsWith(prefix) && ids.includes(id)) next.set(k, ids.filter((x) => x !== id))
      accountListsCache.value = next
      setIn(listMembersCache, listKey(userKey, id), undefined)
    } catch {
      if (generation === ownerGeneration()) toast(`Couldn't delete ${named(w.confirmed)}.`)
    }
    doneWith(userKey, id, w)
    const before = w.confirmed
    if (!ok && before) {
      putLists(userKey, (ls) => (ls.some((l) => l.id === id) ? ls
        : [...ls.slice(0, Math.max(0, at)), before, ...ls.slice(Math.max(0, at))]))
    }
    end([userKey])
    return ok
  })
}

// Adds or removes the account in what is known: the list's members and the
// account's lists. `at` puts a member back where it was.
function applyMember(
  userKey: UserKey, listId: string, account: mastodon.v1.Account, member: boolean, at = -1,
): void {
  const mKey = listKey(userKey, listId)
  const members = listMembersCache.value.get(mKey)
  if (members) {
    const without = members.filter((a) => a.id !== account.id)
    const back = at >= 0 && at <= without.length
      ? [...without.slice(0, at), account, ...without.slice(at)] : [...without, account]
    setIn(listMembersCache, mKey, member ? back : without)
  }
  const aKey = listKey(userKey, account.id)
  const ids = accountListsCache.value.get(aKey)
  if (ids) {
    const without = ids.filter((x) => x !== listId)
    setIn(accountListsCache, aKey, member ? [...without, listId] : without)
  }
}

// One membership's writes: whether the server has it, where the member
// stood in the list, and how many writes are queued.
interface MemberWrites { confirmed: boolean; at: number; count: number }
const memberWrites = new Map<string, MemberWrites>()

/**
 * Adds the account to the list, or removes it. The change shows at once.
 * Changes to one membership go to the server in order; when the last one
 * has answered, the cache shows what the server has, and a failure says so.
 * The server adds only an account the reader follows. `at` is where an
 * added member goes in the known members (an Undo puts it back in place).
 */
export async function setListMember(
  listId: string, account: mastodon.v1.Account, member: boolean, opts: ListsOpts & { at?: number } = {},
): Promise<boolean> {
  const client = (opts.clientSource ?? defaultSource)()
  if (!client) return false
  const userKey = client.userKey
  const generation = ownerGeneration()
  const key = listKey(userKey, `member ${listId} ${account.id}`)
  let w = memberWrites.get(key)
  if (!w) {
    const at = listMembers(listId, userKey)?.findIndex((a) => a.id === account.id) ?? -1
    w = { confirmed: !member, at, count: 0 }
    memberWrites.set(key, w)
  }
  const writes = w
  writes.count += 1
  applyMember(userKey, listId, account, member, member ? opts.at ?? -1 : -1)
  const keys = [membersKey(userKey, listId), accountKey(userKey, account.id)]
  begin(keys)
  return enqueue(key, async () => {
    let ok = false
    try {
      if (member) await client.addListAccounts(listId, [account.id])
      else await client.removeListAccounts(listId, [account.id])
      writes.confirmed = member
      ok = true
    } catch {
      if (generation === ownerGeneration()) {
        const title = named(listById(listId, userKey))
        toast(member ? `Couldn't add @${account.acct} to ${title}.` : `Couldn't remove @${account.acct} from ${title}.`)
      }
    }
    writes.count -= 1
    if (writes.count === 0) {
      memberWrites.delete(key)
      // This was the last write, so the cache shows its intent; put the
      // server's state back if that failed.
      if (writes.confirmed !== member) applyMember(userKey, listId, account, writes.confirmed, writes.at)
    }
    end(keys)
    return ok
  })
}

/**
 * Test-only — do not use in production code. Forgets every queued write,
 * pending mark and waiting read, so a write a test left hanging does not
 * hold the next test. The caches are the test's to reset.
 */
export function _resetListsForTests(): void {
  queues.clear()
  pending.clear()
  revisions.clear()
  idleWaiters.clear()
  listWrites.clear()
  memberWrites.clear()
}
