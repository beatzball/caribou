import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import { cacheStatus } from './caches.js'

export interface DraftMedia {
  id: string
  type: mastodon.v1.MediaAttachmentType
  url: string
  previewUrl: string | null
  description: string
}

export interface ComposeDraft {
  text: string
  spoilerText: string
  cw: boolean
  visibility: mastodon.v1.StatusVisibility
  inReplyToId: string | null
  media: DraftMedia[]
  // One key per draft, kept across reloads: a retry after a lost response
  // gets the first post back from the server instead of a second post.
  idempotencyKey: string
}

// A new post and each reply keep their own draft, so opening a reply does
// not overwrite a half-written post, and the reverse.
export type DraftSlot = 'new' | `reply:${string}`

export function draftSlot(inReplyToId: string | null | undefined): DraftSlot {
  return inReplyToId ? `reply:${inReplyToId}` : 'new'
}

function newKey(): string {
  return globalThis.crypto.randomUUID()
}

export function emptyDraft(init: Partial<ComposeDraft> = {}): ComposeDraft {
  return {
    text: '',
    spoilerText: '',
    cw: false,
    visibility: 'public',
    inReplyToId: null,
    media: [],
    idempotencyKey: newKey(),
    ...init,
  }
}

export function isDraftEmpty(d: ComposeDraft): boolean {
  return d.text.trim() === '' && d.spoilerText.trim() === '' && d.media.length === 0
}

// `removeActiveUser` clears this key on sign-out.
function storageKey(userKey: UserKey): string {
  return `caribou.drafts.${userKey}`
}

function readAll(userKey: UserKey): Partial<Record<DraftSlot, ComposeDraft>> {
  try {
    const raw = localStorage.getItem(storageKey(userKey))
    const parsed = raw ? JSON.parse(raw) as unknown : null
    return parsed && typeof parsed === 'object' ? parsed as Partial<Record<DraftSlot, ComposeDraft>> : {}
  } catch {
    return {}
  }
}

function writeAll(userKey: UserKey, all: Partial<Record<DraftSlot, ComposeDraft>>): void {
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(storageKey(userKey))
    else localStorage.setItem(storageKey(userKey), JSON.stringify(all))
  } catch {
    // Storage full or blocked: the draft lives on in the open dialog.
  }
}

export function loadDraft(userKey: UserKey, slot: DraftSlot): ComposeDraft | null {
  const d = readAll(userKey)[slot]
  if (!d || typeof d.text !== 'string') return null
  return emptyDraft(d)
}

// An empty draft is removed rather than stored, so a dialog opened and
// closed again leaves nothing behind.
export function saveDraft(userKey: UserKey, slot: DraftSlot, draft: ComposeDraft): void {
  const all = readAll(userKey)
  if (isDraftEmpty(draft)) delete all[slot]
  else all[slot] = draft
  writeAll(userKey, all)
}

export function clearDraft(userKey: UserKey, slot: DraftSlot): void {
  const all = readAll(userKey)
  delete all[slot]
  writeAll(userKey, all)
}

export interface PostedDetail { status: mastodon.v1.Status }

// Posts the draft, then clears it. On failure the draft stays stored and
// the error is rethrown for the caller to show.
export async function postDraft(
  client: CaribouClient, slot: DraftSlot, draft: ComposeDraft,
): Promise<mastodon.v1.Status> {
  const status = await client.createStatus({
    status: draft.text,
    visibility: draft.visibility,
    ...(draft.cw && draft.spoilerText.trim() ? { spoilerText: draft.spoilerText, sensitive: true } : {}),
    ...(draft.inReplyToId ? { inReplyToId: draft.inReplyToId } : {}),
    ...(draft.media.length > 0 ? { mediaIds: draft.media.map((m) => m.id) } : {}),
  }, { idempotencyKey: draft.idempotencyKey })
  clearDraft(client.userKey, slot)
  cacheStatus(status)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<PostedDetail>('caribou:posted', { detail: { status } }))
  }
  return status
}
