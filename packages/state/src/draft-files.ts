// Image bytes of stored Bluesky redrafts (#190; README, "Bluesky delete and
// redraft", "Image bytes"). localStorage is too small, so they live in
// IndexedDB, keyed by account, slot and image id.
import type { UserKey } from '@beatzball/caribou-auth'
import { loadDraft, type DraftSlot } from './compose.js'

const DB = 'caribou-draft-files'
const STORE = 'files'
// A separator no user key, slot or id contains.
const SEP = '\u0000'

interface Row {
  key: string
  userKey: UserKey
  slot: DraftSlot
  id: string
  type: string
  bytes: ArrayBuffer
}

let opening: Promise<IDBDatabase> | null = null
let failNextPut = false

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store the draft images.'))
      return
    }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the draft image store.'))
  })
  // A failed open is tried again next time.
  opening.catch(() => { opening = null })
  return opening
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('The draft image store refused the write.'))
    tx.onabort = () => reject(tx.error ?? new Error('The draft image store refused the write.'))
  })
}

function prefix(userKey: UserKey, slot: DraftSlot): string {
  return `${userKey}${SEP}${slot}${SEP}`
}

function slotRange(userKey: UserKey, slot: DraftSlot): IDBKeyRange {
  const p = prefix(userKey, slot)
  return IDBKeyRange.bound(p, `${p}￿`)
}

/** Stores the bytes of a slot's images, by image id. Rejects when the store refuses. */
export async function putDraftFiles(userKey: UserKey, slot: DraftSlot, files: Record<string, Blob>): Promise<void> {
  if (failNextPut) {
    failNextPut = false
    throw new Error('The draft image store refused the write.')
  }
  // Read every Blob before the transaction: it closes on an await.
  const rows: Row[] = await Promise.all(Object.entries(files).map(async ([id, blob]) => ({
    key: prefix(userKey, slot) + id, userKey, slot, id, type: blob.type, bytes: await blob.arrayBuffer(),
  })))
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const row of rows) store.put(row)
  await done(tx)
}

/** The bytes stored for a slot, by image id; empty when none, or when the store cannot be read. */
export async function getDraftFiles(userKey: UserKey, slot: DraftSlot): Promise<Record<string, Blob>> {
  try {
    const db = await open()
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll(slotRange(userKey, slot))
    const rows = await new Promise<Row[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as Row[])
      req.onerror = () => reject(req.error)
    })
    return Object.fromEntries(rows.map((r) => [r.id, new Blob([r.bytes], { type: r.type })]))
  } catch {
    return {}
  }
}

/** Removes a slot's bytes. */
export async function removeDraftFiles(userKey: UserKey, slot: DraftSlot): Promise<void> {
  try {
    const db = await open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(slotRange(userKey, slot))
    await done(tx)
  } catch {
    // Nothing to remove, or no store: prune tries again later.
  }
}

// A redraft's bytes are keyed by its final slot, `redraft:<key>`, from the
// start; while its delete runs the draft sits in `staged:<key>`.
function draftHas(userKey: UserKey, slot: DraftSlot, id: string): boolean {
  const has = (s: DraftSlot) => (loadDraft(userKey, s)?.bluesky?.images ?? []).some((i) => i.id === id)
  return has(slot) || (slot.startsWith('redraft:') && has(`staged:${slot.slice('redraft:'.length)}`))
}

/**
 * Removes every entry whose account, slot and image id is not in a stored
 * draft: a sent, discarded or signed-out draft, or a removed image.
 */
export async function pruneDraftFiles(): Promise<void> {
  try {
    const db = await open()
    const read = db.transaction(STORE, 'readonly')
    const req = read.objectStore(STORE).getAll()
    const rows = await new Promise<Row[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as Row[])
      req.onerror = () => reject(req.error)
    })
    const dead = rows.filter((r) => !draftHas(r.userKey, r.slot, r.id))
    if (dead.length === 0) return
    const tx = db.transaction(STORE, 'readwrite')
    for (const r of dead) tx.objectStore(STORE).delete(r.key)
    await done(tx)
  } catch {
    // No store: nothing to prune.
  }
}

/** Tests only: empty the store. */
export async function _testOnlyClearDraftFiles(): Promise<void> {
  failNextPut = false
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).clear()
  await done(tx)
}

/** Tests only: the next put is refused, as by a full store. */
export function _testOnlyFailNextPut(): void {
  failNextPut = true
}
