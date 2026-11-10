import type { Agent } from '@atproto/api'
import {
  CaribouError,
  type Account, type CaribouClient, type List, type ListInput,
} from '@beatzball/caribou-mastodon-client'
import { BlueskyListPartlyDeleted, BlueskyWriteUnknown } from './errors.js'
import type { ProfileView } from './map/account.js'

// The rules are in the README, "Lists (#195)".

const LIST = 'app.bsky.graph.list'
const ITEM = 'app.bsky.graph.listitem'
const CURATE = 'app.bsky.graph.defs#curatelist'
const DELETE = 'com.atproto.repo.applyWrites#delete'

/** `listRecords` page size, and how many pages a read goes through at most. */
const PAGE = 100
export const MAX_RECORD_PAGES = 50
/** The PDS's limit on writes in one `applyWrites`. */
export const MAX_WRITES = 200
/** The lexicon's `maxLength` for a list's name, in UTF-8 bytes. */
export const MAX_LIST_NAME_BYTES = 64
/** The AppView's limit for `getProfiles`. */
const PROFILES_BATCH = 25

/**
 * A TID: the lexicon's record key for a list (`key: 'tid'`). Written as
 * ranges: the whole base32 alphabet spelled out is the marker
 * `bluesky-chunk.spec.ts` looks for, and this module is in the main bundle.
 */
const TID = /^[2-7a-j][2-7a-z]{12}$/

/** The parts of a signed-in `Agent` the lists call. */
export type BlueskyListsAgent = Pick<Agent, 'did' | 'getProfiles'> & {
  com: {
    atproto: {
      repo: Pick<Agent['com']['atproto']['repo'],
        'listRecords' | 'getRecord' | 'createRecord' | 'putRecord' | 'applyWrites'>
    }
  }
}

type ListMethods = Pick<CaribouClient,
  | 'fetchLists' | 'fetchList' | 'createList' | 'updateList' | 'deleteList'
  | 'fetchListAccounts' | 'addListAccounts' | 'removeListAccounts' | 'fetchAccountLists'>

type Run = <T>(key: string, fn: () => Promise<T>) => Promise<T>
type Write = <T>(fn: () => Promise<T>) => Promise<T>

interface RepoRecord { uri: string; cid?: string; value: unknown }
interface ItemRecord { rkey: string; subject: string; list: string }

export interface ListsDeps {
  agent: BlueskyListsAgent
  /** A read through the client's dedup, errors normalized. */
  run: Run
  /** A write: no dedup, errors normalized. */
  write: Write
  /** A profile view → an account with the reader's decision. */
  account(view: ProfileView, coverage: { labelersCovered?: string[] }): Account
  /** The coverage of one AppView answer (README, "Labeler coverage"). */
  answer<D>(call: () => Promise<{ data: D; headers?: Record<string, string | undefined> }>): Promise<{ data: D; coverage: { labelersCovered?: string[] } }>
  nextRkey?: () => string
}

function isRecordMissing(err: unknown): boolean {
  return (err as { error?: unknown } | null)?.error === 'RecordNotFound'
}

// An answered refusal: the PDS read the request and said no, so nothing
// was written. Anything else (no answer, a timeout, a 5xx) is in doubt.
function answeredRefusal(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

function rkeyOf(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1)
}

function stringField(value: unknown, key: string): string | null {
  const v = (value as Record<string, unknown> | null)?.[key]
  return typeof v === 'string' ? v : null
}

/** The record as a curate list, or null when it is not a valid one. */
function asList(rec: RepoRecord): List | null {
  const rkey = rkeyOf(rec.uri)
  const name = stringField(rec.value, 'name')
  if (!TID.test(rkey) || !name || stringField(rec.value, 'purpose') !== CURATE) return null
  return { id: rkey, title: name, repliesPolicy: 'list', exclusive: false }
}

function asItem(rec: RepoRecord): ItemRecord | null {
  const subject = stringField(rec.value, 'subject')
  const list = stringField(rec.value, 'list')
  return subject && list ? { rkey: rkeyOf(rec.uri), subject, list } : null
}

function refusal(message: string): CaribouError {
  return Object.assign(new CaribouError('unknown', `Bluesky: ${message}`), { userMessage: message })
}

// L1: a cut scan never authorizes a destructive write or shows as whole.
// The message is the reader's words, since a screen shows it as it is.
const TOO_LARGE_TO_CHANGE = 'This list is too large to change here. Use bsky.app.'
const TOO_LARGE_TO_SHOW = 'This list is too large to show here. Use bsky.app.'
function tooLarge(message: string): CaribouError {
  return Object.assign(new CaribouError('unknown', message), { userMessage: message })
}

function listName(input: ListInput): string {
  const name = input.title.trim()
  if (!name) throw refusal('Give the list a title.')
  if (new TextEncoder().encode(name).length > MAX_LIST_NAME_BYTES) throw refusal('This title is too long for Bluesky.')
  return name
}

/** A member the AppView did not return: listed so it can be removed, with no decision. */
function unknownMember(did: string): Account {
  return {
    id: did, username: did, acct: did, url: `https://bsky.app/profile/${did}`, displayName: '', note: '',
    avatar: '', avatarStatic: '', header: '', headerStatic: '', locked: false, fields: [], emojis: [],
    bot: false, group: false, createdAt: '', lastStatusAt: null, statusesCount: 0, followersCount: 0,
    followingCount: 0, roles: [], bluesky: { did, handleInvalid: true, labels: [] },
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The reader's curate lists over their own repo (README, "Lists"). Reads go
 * to the PDS; profiles and the list feed come from the AppView.
 */
export function createLists(deps: ListsDeps): ListMethods & { listUri(id: string): string } {
  const { agent, run, write } = deps
  // The rkey of a create whose answer did not arrive, by intent. The next
  // create of the same intent reads it first and reuses it.
  const unanswered = new Map<string, string>()

  function did(): string {
    if (!agent.did) throw new CaribouError('unauthorized', 'no active session')
    return agent.did
  }

  function listUri(id: string): string {
    if (!TID.test(id)) throw new CaribouError('not_found', 'Bluesky: not a list id', { status: 404 })
    return `at://${did()}/${LIST}/${id}`
  }

  // Every record of the collection, and whether the scan read to the end.
  async function records(collection: string): Promise<{ records: RepoRecord[]; complete: boolean }> {
    const repo = did()
    const out: RepoRecord[] = []
    let cursor: string | undefined
    for (let i = 0; i < MAX_RECORD_PAGES; i++) {
      const { data } = await agent.com.atproto.repo.listRecords({ repo, collection, limit: PAGE, ...(cursor ? { cursor } : {}) })
      out.push(...data.records)
      if (!data.cursor || data.records.length === 0) return { records: out, complete: true }
      cursor = data.cursor
    }
    return { records: out, complete: false }
  }

  async function getRecord(collection: string, rkey: string): Promise<RepoRecord | null> {
    try {
      const { data } = await agent.com.atproto.repo.getRecord({ repo: did(), collection, rkey })
      return data
    } catch (err) {
      if (isRecordMissing(err)) return null
      throw err
    }
  }

  async function lists(): Promise<List[]> {
    // A cut catalog is shown as it is: it only hides lists, never writes.
    return (await records(LIST)).records.flatMap((r) => asList(r) ?? [])
  }

  // The list record, only when it is one of the reader's curate lists.
  async function curateRecord(id: string): Promise<RepoRecord & { list: List }> {
    listUri(id)
    const rec = await getRecord(LIST, id)
    const list = rec && asList(rec)
    if (!rec || !list) throw new CaribouError('not_found', 'Bluesky: list not found', { status: 404 })
    return { ...rec, list }
  }

  // The items that match, only from a complete scan; a cut one throws
  // `cut` (L1).
  async function items(filter: (item: ItemRecord) => boolean, cut: () => Error): Promise<ItemRecord[]> {
    const { records: all, complete } = await records(ITEM)
    if (!complete) throw cut()
    return all.flatMap((r) => {
      const item = asItem(r)
      return item && filter(item) ? [item] : []
    })
  }
  const cutChange = () => tooLarge(TOO_LARGE_TO_CHANGE)
  const cutShow = () => tooLarge(TOO_LARGE_TO_SHOW)

  // Deletes in `applyWrites` batches, in the order given. One batch is atomic.
  async function deleteAll(targets: readonly { collection: string; rkey: string }[]): Promise<void> {
    const repo = did()
    for (const batch of chunks(targets, MAX_WRITES)) {
      await agent.com.atproto.repo.applyWrites({
        repo, writes: batch.map((t) => ({ $type: DELETE, collection: t.collection, rkey: t.rkey })),
      })
    }
  }

  /**
   * A write in doubt is decided by a read (README). `settled` answers true
   * when the read shows the write happened. An answered refusal is thrown
   * as it is; a failed read is `BlueskyWriteUnknown`.
   */
  async function decided<T>(attempt: () => Promise<T>, settled: () => Promise<T | false>): Promise<T> {
    try {
      return await attempt()
    } catch (err) {
      if (answeredRefusal(err)) throw err
      let outcome: T | false
      try {
        outcome = await settled()
      } catch {
        throw new BlueskyWriteUnknown(`Could not tell whether the change was saved: ${(err as Error).message}`)
      }
      if (outcome === false) throw err
      return outcome
    }
  }

  // One record per intent: a client-picked rkey, kept until a write answers.
  async function createOnce(intent: string, collection: string, record: Record<string, unknown>): Promise<RepoRecord> {
    if (!deps.nextRkey) throw new CaribouError('not_found', 'Bluesky lists cannot be written: compose is not loaded')
    const repo = did()
    const kept = unanswered.get(intent)
    if (kept) {
      const found = await getRecord(collection, kept)
      if (found) {
        unanswered.delete(intent)
        return found
      }
    }
    const rkey = kept ?? deps.nextRkey()
    unanswered.set(intent, rkey)
    const full = { $type: collection, ...record, createdAt: new Date().toISOString() }
    try {
      const made = await decided(
        async (): Promise<RepoRecord> => {
          const { data } = await agent.com.atproto.repo.createRecord({ repo, collection, rkey, record: full })
          return { uri: data.uri, cid: data.cid, value: full }
        },
        async () => (await getRecord(collection, rkey)) ?? false,
      )
      unanswered.delete(intent)
      return made
    } catch (err) {
      if (answeredRefusal(err)) unanswered.delete(intent)
      throw err
    }
  }

  return {
    listUri,

    fetchLists: () => run('lists', lists),

    fetchList: (id) => run(`list:${id}`, async () => (await curateRecord(id)).list),

    createList: (input) => write(async () => {
      const name = listName(input)
      const made = await createOnce(`${LIST} ${name}`, LIST, { purpose: CURATE, name })
      const list = asList(made)
      if (!list) throw new CaribouError('unknown', 'Bluesky: the PDS answered a record that is not a list')
      return list
    }),

    updateList: (id, input) => write(async () => {
      const name = listName(input)
      const rec = await curateRecord(id)
      const record = { ...(rec.value as Record<string, unknown>), name }
      return decided(
        async () => {
          await agent.com.atproto.repo.putRecord({
            repo: did(), collection: LIST, rkey: id, record, ...(rec.cid ? { swapRecord: rec.cid } : {}),
          })
          return { ...rec.list, title: name }
        },
        async () => {
          const now = await getRecord(LIST, id)
          return now && stringField(now.value, 'name') === name ? { ...rec.list, title: name } : false
        },
      )
    }),

    deleteList: (id) => write(async () => {
      const uri = listUri(id)
      await curateRecord(id)
      const own = (await items((it) => it.list === uri, cutChange)).map((it) => it.rkey)
      // The list last: a failure part way leaves the list, not stray items.
      const targets = [...own.map((rkey) => ({ collection: ITEM, rkey })), { collection: LIST, rkey: id }]
      const batches = chunks(targets, MAX_WRITES)
      const repo = did()
      // Whether some batch may have applied: one answered, or one in doubt.
      let maybeApplied = false
      for (const batch of batches) {
        try {
          await agent.com.atproto.repo.applyWrites({
            repo, writes: batch.map((t) => ({ $type: DELETE, collection: t.collection, rkey: t.rkey })),
          })
          maybeApplied = true
        } catch (err) {
          if (answeredRefusal(err) && !maybeApplied) throw err
          let gone: boolean
          try {
            gone = (await getRecord(LIST, id)) === null
          } catch {
            throw new BlueskyWriteUnknown(`Could not tell whether the list was deleted: ${(err as Error).message}`)
          }
          if (gone) return
          // One call is atomic: the list is there, so nothing happened.
          if (batches.length === 1) throw err
          throw new BlueskyListPartlyDeleted(`Bluesky: the list was partly deleted: ${(err as Error).message}`)
        }
      }
    }),

    fetchListAccounts: (id) => run(`list-accounts:${id}`, async () => {
      const uri = listUri(id)
      await curateRecord(id)
      const dids = [...new Set((await items((it) => it.list === uri, cutShow)).map((it) => it.subject))]
      const pages = await Promise.all(chunks(dids, PROFILES_BATCH).map((actors) =>
        deps.answer(() => agent.getProfiles({ actors }))))
      const byDid = new Map<string, Account>()
      for (const p of pages) for (const v of p.data.profiles) byDid.set(v.did, deps.account(v, p.coverage))
      return dids.map((d) => byDid.get(d) ?? unknownMember(d))
    }),

    addListAccounts: (id, dids) => write(async () => {
      const uri = listUri(id)
      await curateRecord(id)
      for (const subject of dids) await createOnce(`${ITEM} ${uri} ${subject}`, ITEM, { subject, list: uri })
    }),

    removeListAccounts: (id, dids) => write(async () => {
      const uri = listUri(id)
      await curateRecord(id)
      const wanted = new Set(dids)
      const match = (it: ItemRecord) => it.list === uri && wanted.has(it.subject)
      const found = (await items(match, cutChange)).map((it) => it.rkey)
      if (found.length === 0) return
      // A cut deciding read throws, which `decided` turns into unknown.
      await decided(
        () => deleteAll(found.map((rkey) => ({ collection: ITEM, rkey }))),
        async () => ((await items(match, cutChange)).length === 0 ? undefined : false),
      )
    }),

    fetchAccountLists: (accountId) => run(`account-lists:${accountId}`, async () => {
      const [all, held] = await Promise.all([lists(), items((it) => it.subject === accountId, cutShow)])
      const holding = new Set(held.map((it) => it.list))
      const me = did()
      return all.filter((l) => holding.has(`at://${me}/${LIST}/${l.id}`))
    }),
  }
}
