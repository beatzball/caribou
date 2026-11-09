import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { UserKey } from '@beatzball/caribou-auth'
import { emptyBlueskyDraft } from '../bluesky-compose.js'
import { clearDraft, emptyDraft, saveDraft } from '../compose.js'
import { getDraftFiles, pruneDraftFiles, putDraftFiles, removeDraftFiles, _testOnlyClearDraftFiles } from '../draft-files.js'

const A = 'did:plc:a@bsky' as UserKey
const B = 'did:plc:b@bsky' as UserKey

const image = (id: string) => ({
  id, blob: { $type: 'blob' as const, ref: { $link: `bafk${id}` }, mimeType: 'image/jpeg', size: 1 },
  mime: 'image/jpeg', size: 1, alt: '', aspectRatio: null,
})

beforeEach(async () => {
  localStorage.clear()
  await _testOnlyClearDraftFiles()
})

describe('draft files (IndexedDB)', () => {
  it('keeps bytes and type by account, slot and image id', async () => {
    await putDraftFiles(A, 'redraft:k1', { i1: new Blob(['one'], { type: 'image/jpeg' }), i2: new Blob(['two'], { type: 'image/png' }) })
    await putDraftFiles(B, 'redraft:k1', { i1: new Blob(['other account']) })
    const got = await getDraftFiles(A, 'redraft:k1')
    expect(Object.keys(got).sort()).toEqual(['i1', 'i2'])
    expect(await got.i1!.text()).toBe('one')
    expect(got.i2!.type).toBe('image/png')
    expect(await (await getDraftFiles(B, 'redraft:k1')).i1!.text()).toBe('other account')
    expect(await getDraftFiles(A, 'redraft:k2')).toEqual({})
  })

  it('removes one slot\'s bytes', async () => {
    await putDraftFiles(A, 'redraft:k1', { i1: new Blob(['one']) })
    await putDraftFiles(A, 'redraft:k2', { i9: new Blob(['nine']) })
    await removeDraftFiles(A, 'redraft:k1')
    expect(await getDraftFiles(A, 'redraft:k1')).toEqual({})
    expect(Object.keys(await getDraftFiles(A, 'redraft:k2'))).toEqual(['i9'])
  })

  it('prune keeps only bytes whose account, slot and image a stored draft still has', async () => {
    saveDraft(A, 'redraft:k1', emptyDraft({ text: 'kept', bluesky: emptyBlueskyDraft({ images: [image('i1')] }) }))
    await putDraftFiles(A, 'redraft:k1', { i1: new Blob(['1']), gone: new Blob(['x']) })
    // A posted or discarded draft: its slot is empty.
    await putDraftFiles(A, 'redraft:k2', { i5: new Blob(['5']) })
    // An account signed out: its drafts are gone.
    await putDraftFiles(B, 'redraft:k3', { i7: new Blob(['7']) })
    await pruneDraftFiles()
    expect(Object.keys(await getDraftFiles(A, 'redraft:k1'))).toEqual(['i1'])
    expect(await getDraftFiles(A, 'redraft:k2')).toEqual({})
    expect(await getDraftFiles(B, 'redraft:k3')).toEqual({})
    clearDraft(A, 'redraft:k1')
    await pruneDraftFiles()
    expect(await getDraftFiles(A, 'redraft:k1')).toEqual({})
  })
})
