import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import type { CaribouClient, Status } from '@beatzball/caribou-mastodon-client'
import {
  clearDraft, draftSlot, emptyDraft, findRedraftSlot, loadDraft, postDraft, saveDraft,
} from '../compose.js'
import { statusCache } from '../caches.js'
import { activeUserKey, addUserSession, removeActiveUser, users, type UserSession } from '../users.js'

const alice = toUserKey('alice', 'example.social')
const bob = toUserKey('bob', 'example.social')

function fakeClient(userKey = alice, createStatus = vi.fn()): CaribouClient {
  return { userKey, createStatus } as unknown as CaribouClient
}

function posted(id: string): Status {
  return { id, account: { id: 'a1' } } as Status
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

  it('sends sensitive and language when a redraft set them', async () => {
    const create = vi.fn().mockResolvedValue(posted('p3'))
    await postDraft(fakeClient(alice, create), 'new',
      emptyDraft({ text: 'hi', sensitive: true, language: 'de' }))
    expect(create.mock.calls[0]![0]).toEqual({ status: 'hi', visibility: 'public', sensitive: true, language: 'de' })
  })

  it('keeps the draft when the post fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('boom'))
    const d = emptyDraft({ text: 'keep me' })
    saveDraft(alice, 'new', d)
    await expect(postDraft(fakeClient(alice, create), 'new', d)).rejects.toThrow('boom')
    expect(loadDraft(alice, 'new')?.text).toBe('keep me')
  })
})

describe('findRedraftSlot', () => {
  it('names a kept redraft, oldest first, and nothing when there is none', () => {
    expect(findRedraftSlot(alice)).toBeNull()
    saveDraft(alice, 'new', emptyDraft({ text: 'plain' }))
    expect(findRedraftSlot(alice)).toBeNull()
    saveDraft(alice, 'redraft:a', emptyDraft({ text: 'one' }))
    saveDraft(alice, 'redraft:b', emptyDraft({ text: 'two' }))
    expect(findRedraftSlot(alice)).toBe('redraft:a')
    clearDraft(alice, 'redraft:a')
    expect(findRedraftSlot(alice)).toBe('redraft:b')
  })
})

describe('a draft with a poll', () => {
  const poll = { options: [' Tea ', 'Coffee', ''], expiresIn: 3600, multiple: true, hideTotals: false }

  it('a poll with text in an option is not an empty draft, and is stored', () => {
    saveDraft(alice, 'new', emptyDraft({ poll: { ...poll, options: ['', 'x'] } }))
    expect(loadDraft(alice, 'new')?.poll?.options).toEqual(['', 'x'])
    saveDraft(alice, 'new', emptyDraft({ poll: { ...poll, options: ['', ' '] } }))
    expect(loadDraft(alice, 'new')).toBeNull()
  })

  it('postDraft sends the trimmed, filled options and the settings', async () => {
    const createStatus = vi.fn(async (_p: unknown, _o?: unknown) => posted('p1'))
    await postDraft(fakeClient(alice, createStatus), 'new', emptyDraft({ text: 'which?', poll }))
    expect(createStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'which?',
      poll: { options: ['Tea', 'Coffee'], expiresIn: 3600, multiple: true, hideTotals: false },
    }), expect.anything())
    expect(createStatus.mock.calls[0]![0]).not.toHaveProperty('mediaIds')
  })

  it('postDraft never sends a poll with media', async () => {
    const createStatus = vi.fn(async (_p: unknown, _o?: unknown) => posted('p2'))
    const media = [{ id: 'm1', type: 'image' as const, url: '', previewUrl: null, description: '' }]
    await postDraft(fakeClient(alice, createStatus), 'new', emptyDraft({ text: 'x', poll, media }))
    expect(createStatus.mock.calls[0]![0]).not.toHaveProperty('poll')
  })
})
