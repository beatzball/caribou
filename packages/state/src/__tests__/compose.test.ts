import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import type { mastodon } from 'masto'
import {
  clearDraft, draftSlot, emptyDraft, loadDraft, postDraft, saveDraft,
} from '../compose.js'
import { statusCache } from '../caches.js'
import { activeUserKey, addUserSession, removeActiveUser, users, type UserSession } from '../users.js'

const alice = toUserKey('alice', 'example.social')
const bob = toUserKey('bob', 'example.social')

function fakeClient(userKey = alice, createStatus = vi.fn()): CaribouClient {
  return { userKey, createStatus } as unknown as CaribouClient
}

function posted(id: string): mastodon.v1.Status {
  return { id, account: { id: 'a1' } } as mastodon.v1.Status
}

beforeEach(() => {
  localStorage.clear()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
})

describe('draft persistence', () => {
  it('stores drafts per user and per slot', () => {
    saveDraft(alice, 'new', emptyDraft({ text: 'alice new' }))
    saveDraft(alice, 'reply:9', emptyDraft({ text: 'alice reply', inReplyToId: '9' }))
    saveDraft(bob, 'new', emptyDraft({ text: 'bob new' }))
    expect(loadDraft(alice, 'new')?.text).toBe('alice new')
    expect(loadDraft(alice, draftSlot('9'))?.text).toBe('alice reply')
    expect(loadDraft(bob, 'new')?.text).toBe('bob new')
    expect(loadDraft(bob, 'reply:9')).toBeNull()
  })

  it('keeps the idempotency key across a reload', () => {
    const d = emptyDraft({ text: 'x' })
    saveDraft(alice, 'new', d)
    expect(loadDraft(alice, 'new')?.idempotencyKey).toBe(d.idempotencyKey)
  })

  it('an empty draft removes the stored one', () => {
    saveDraft(alice, 'new', emptyDraft({ text: 'x' }))
    saveDraft(alice, 'new', emptyDraft())
    expect(loadDraft(alice, 'new')).toBeNull()
    expect(localStorage.getItem(`caribou.drafts.${alice}`)).toBeNull()
  })

  it('clearDraft leaves the other slots alone', () => {
    saveDraft(alice, 'new', emptyDraft({ text: 'keep' }))
    saveDraft(alice, 'reply:9', emptyDraft({ text: 'drop' }))
    clearDraft(alice, 'reply:9')
    expect(loadDraft(alice, 'new')?.text).toBe('keep')
    expect(loadDraft(alice, 'reply:9')).toBeNull()
  })

  it('ignores corrupt storage', () => {
    localStorage.setItem(`caribou.drafts.${alice}`, '{not json')
    expect(loadDraft(alice, 'new')).toBeNull()
  })

  it('sign-out removes the user’s drafts', () => {
    addUserSession({
      userKey: alice, server: 'example.social', token: 't', vapidKey: '',
      account: { id: 'a1' } as UserSession['account'], createdAt: 1,
    })
    saveDraft(alice, 'new', emptyDraft({ text: 'x' }))
    removeActiveUser()
    expect(loadDraft(alice, 'new')).toBeNull()
  })
})

describe('postDraft', () => {
  it('sends the draft with its idempotency key, caches the result, clears the draft, and announces it', async () => {
    const create = vi.fn().mockResolvedValue(posted('p1'))
    const d = emptyDraft({
      text: 'hi', cw: true, spoilerText: 'spoiler', visibility: 'unlisted', inReplyToId: '9',
      media: [{ id: 'm1', type: 'image', url: 'u', previewUrl: null, description: '' }],
    })
    saveDraft(alice, 'reply:9', d)
    const seen: unknown[] = []
    const onPosted = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('caribou:posted', onPosted)
    try {
      await postDraft(fakeClient(alice, create), 'reply:9', d)
    } finally {
      window.removeEventListener('caribou:posted', onPosted)
    }
    expect(create).toHaveBeenCalledWith({
      status: 'hi', visibility: 'unlisted', spoilerText: 'spoiler', sensitive: true,
      inReplyToId: '9', mediaIds: ['m1'],
    }, { idempotencyKey: d.idempotencyKey })
    expect(statusCache.value.get('p1')?.id).toBe('p1')
    expect(loadDraft(alice, 'reply:9')).toBeNull()
    expect(seen).toEqual([{ status: posted('p1') }])
  })

  it('drops the spoiler when the CW toggle is off', async () => {
    const create = vi.fn().mockResolvedValue(posted('p2'))
    await postDraft(fakeClient(alice, create), 'new', emptyDraft({ text: 'hi', spoilerText: 'stale' }))
    expect(create.mock.calls[0]![0]).toEqual({ status: 'hi', visibility: 'public' })
  })

  it('keeps the draft when the post fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'))
    const d = emptyDraft({ text: 'keep me' })
    saveDraft(alice, 'new', d)
    await expect(postDraft(fakeClient(alice, create), 'new', d)).rejects.toThrow('boom')
    expect(loadDraft(alice, 'new')?.text).toBe('keep me')
  })
})
