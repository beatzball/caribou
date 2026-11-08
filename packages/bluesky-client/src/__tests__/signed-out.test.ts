import { describe, expect, it, vi } from 'vitest'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import * as fx from '../__fixtures__/ssr-appview.js'
import {
  guardActor, guardFeedEntry, guardThreadNode, hiddenAccount, signedOutLabelDefs, signedOutProfilePage,
  signedOutStatus, signedOutThread, type SignedOutCall, type SignedOutSource,
} from '../signed-out.js'

// The signed-out pages (README, "Signed-out pages"): the one copy of the
// spec 8.3 allow-list, shared by the app's SSR and its browser fallback.

const NOTICE = 'This account asked to be seen only by signed-in readers.'

function source(over: Partial<SignedOutSource> & { fail?: Set<string> } = {}) {
  const calls: Array<{ method: string; call: SignedOutCall }> = []
  const cleaned = { status: 0, account: 0 }
  const src: SignedOutSource = {
    async xrpc<T>(method: string, params: Record<string, string | undefined>, call: SignedOutCall): Promise<T> {
      calls.push({ method, call })
      if (over.fail?.has(method)) throw new Error(`fail ${method}`)
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v)
      const { status, body } = fx.appviewAnswer(method, q)
      if (status !== 200) throw new Error(`status ${status}`)
      return body as T
    },
    clean: {
      status: (s: Status) => { cleaned.status++; return s },
      account: (a: Account) => { cleaned.account++; return a },
    },
    ...(over.mustPropagate ? { mustPropagate: over.mustPropagate } : {}),
  }
  return { src, calls, cleaned }
}

const ALL_SECRETS = [...fx.HANA_SECRETS, ...fx.NORA_SECRETS, ...fx.PARTIAL_SECRETS]

function expectNone(v: unknown, secrets: readonly string[]) {
  const text = JSON.stringify(v)
  for (const s of secrets) expect(text, s).not.toContain(s)
}

describe('signedOutProfilePage', () => {
  it('a visible profile: the account with moderation, its statuses, the cursor, each cleaned, each call named', async () => {
    const { src, calls, cleaned } = source()
    const page = await signedOutProfilePage(src, 'alice.example.com', { tab: 'posts' })
    if (page.kind !== 'ok') throw new Error('expected ok')
    expect(page.account).toMatchObject({ id: 'did:plc:alice', displayName: 'Alice Visible' })
    expect(page.account.bluesky?.moderation?.contexts.profileView).toBeDefined()
    expect(page.nextCursor).toBe('cursor-page-2')
    expect(page.statuses.length).toBe(fx.aliceFeed.feed.length)
    expect(page.statuses.every((s) => s.bluesky?.viewerOf === null)).toBe(true)
    expect(cleaned).toEqual({ account: 1, status: page.statuses.length })
    expect(calls.map((c) => c.call).sort()).toEqual(['authorFeed', 'labelDefs', 'profile'])
    expect(calls.find((c) => c.call === 'authorFeed')!.method).toBe('app.bsky.feed.getAuthorFeed')
  })

  it('the tab and cursor go to the author feed; an empty page ends the list', async () => {
    const { src } = source()
    const page = await signedOutProfilePage(src, 'alice.example.com', { tab: 'media', cursor: 'cursor-page-2' })
    if (page.kind !== 'ok') throw new Error('expected ok')
    expect(page.nextCursor).toBeNull()
    const bob = await signedOutProfilePage(source().src, 'bob.example.com', { tab: 'posts' })
    expect(bob).toMatchObject({ kind: 'ok', statuses: [], nextCursor: null })
  })

  it.each(['hana.example.com', 'nora.example.com', 'pia.example.com', 'quin.example.com'])(
    'a hidden profile (%s): hidden, and the feed is never asked for', async (actor) => {
      const { src, calls } = source()
      expect(await signedOutProfilePage(src, actor, { tab: 'posts' })).toEqual({ kind: 'hidden' })
      expect(calls.some((c) => c.call === 'authorFeed')).toBe(false)
    })

  it('every hidden author in the feed: none of their strings are in the whole result', async () => {
    const page = await signedOutProfilePage(source().src, 'alice.example.com', { tab: 'posts' })
    expectNone(page, ALL_SECRETS)
    if (page.kind !== 'ok') throw new Error('expected ok')
    const hiddenItems = page.statuses.filter((s) => s.account.bluesky?.labels?.some((l) => l.val === '!no-unauthenticated'))
    // hana's repost, nora's repost, the repost by hana, pia's post, the repost by quin.
    expect(hiddenItems.map((s) => s.account.id).sort()).toEqual(['did:plc:hana', 'did:plc:hana', 'did:plc:nora', 'did:plc:pia', 'did:plc:quin'])
    expect(hiddenItems.every((s) => s.content === '' && s.reblog === null && s.account.bluesky?.handleInvalid)).toBe(true)
    expect(JSON.stringify(page)).toContain(NOTICE)
  })

  it('an error from the profile call reaches the caller', async () => {
    await expect(signedOutProfilePage(source().src, fx.BROKEN_HANDLE, { tab: 'posts' })).rejects.toThrow()
  })
})

describe('signedOutThread', () => {
  it('hidden parent, root and replies are kept in place with nothing of theirs; the rest maps', async () => {
    const t = await signedOutThread(source().src, 'alice.example.com', '3kalicefocus')
    expect(t.focused.content).toContain('alice thread focus')
    expect(t.ancestors.map((s) => s.account.id)).toEqual(['did:plc:hana', 'did:plc:bob'])
    expect(t.ancestors[0]!.content).toBe('')
    expect(t.descendants.map((s) => s.account.id)).toEqual(['did:plc:hana', 'did:plc:carol', 'did:plc:pia'])
    expect(t.descendants[0]!.inReplyToId).toBe(fx.threadFocus.uri)
    expectNone(t, ALL_SECRETS)
  })

  it('a focused post by a hidden author is the notice item', async () => {
    const t = await signedOutThread(source().src, 'hana.example.com', '3khanafocus')
    expect(t.focused).toMatchObject({ id: fx.hanaFocus.uri, content: '', account: { acct: '' } })
    expectNone(t, fx.HANA_SECRETS)
  })

  it('throws when the post is not there', async () => {
    await expect(signedOutThread(source().src, 'alice.example.com', '3knothere')).rejects.toThrow()
    const notFoundNode = { ...source().src, xrpc: async <T>() => ({ thread: { $type: 'app.bsky.feed.defs#notFoundPost' } }) as T }
    await expect(signedOutThread(notFoundNode, 'alice.example.com', 'x')).rejects.toThrow(/not found/)
  })
})

describe('signedOutLabelDefs', () => {
  it('reads Bluesky\'s labeler definitions', async () => {
    const defs = await signedOutLabelDefs(source().src)
    expect(defs && Object.keys(defs)).toEqual([fx.BSKY_LABELER])
  })

  it('a failure is null (moderation then covers)', async () => {
    expect(await signedOutLabelDefs(source({ fail: new Set(['app.bsky.labeler.getServices']) }).src)).toBeNull()
  })

  it('an error the source marks as one to pass on is thrown, never null; and it fails the page', async () => {
    const mustPropagate = vi.fn((err: unknown) => String(err).includes('getServices'))
    const { src } = source({ fail: new Set(['app.bsky.labeler.getServices']), mustPropagate })
    await expect(signedOutLabelDefs(src)).rejects.toThrow(/getServices/)
    await expect(signedOutThread(src, 'alice.example.com', '3kalicefocus')).rejects.toThrow(/getServices/)
    await expect(signedOutProfilePage(src, 'hana.example.com', { tab: 'posts' })).rejects.toThrow(/getServices/)
  })
})

describe('the guards', () => {
  it('guardFeedEntry drops a feed item\'s reply, and checks author and reposter', () => {
    const entry = fx.aliceFeed.feed.find((e) => 'reply' in e)!
    const out = guardFeedEntry(entry) as Record<string, unknown>
    expect('reply' in out).toBe(false)
    expectNone(out, ['hana parent post', 'hana root post'])
    const repost = guardFeedEntry(fx.aliceFeed.feed.find((e) => e.reason?.by.did === 'did:plc:quin')!) as { reason: { by: unknown } }
    expect(repost.reason.by).toEqual({ did: 'did:plc:quin', handle: 'handle.invalid', labels: [expect.objectContaining({ val: '!no-unauthenticated' })] })
  })

  it('guardFeedEntry leaves an entry with no repost reason, or another reason, as it is apart from the author', () => {
    const pin = { post: fx.alicePosts.plain, reason: { $type: 'app.bsky.feed.defs#reasonPin' } }
    expect(guardFeedEntry(pin)).toEqual(pin)
  })

  it('guardActor keeps a proven author and marks the rest, with a DID from the record when it has none', () => {
    expect(guardActor(fx.alice, 'did:plc:x')).toBe(fx.alice)
    expect(guardActor(undefined, 'did:plc:x')).toMatchObject({ did: 'did:plc:x', handle: 'handle.invalid' })
    expect(guardActor({ did: 'nope', labels: [] }, 'did:plc:x')).toMatchObject({ did: 'did:plc:x' })
  })

  it('guardThreadNode passes a node that is not a thread post through', () => {
    const node = { $type: 'app.bsky.feed.defs#blockedPost', uri: 'at://x' }
    expect(guardThreadNode(node)).toBe(node)
  })

  it('hiddenAccount keeps only the DID and the hiding label', () => {
    const a = hiddenAccount({
      id: 'did:plc:hana', acct: 'hana.example.com', displayName: 'Hana Hidden',
      bluesky: { did: 'did:plc:hana', handleInvalid: false, labels: [
        { src: 'did:plc:hana', uri: 'x', val: '!no-unauthenticated', cts: '' }, { src: 'did:plc:hana', uri: 'x', val: 'other', cts: '' },
      ] },
    } as Account)
    expectNone(a, ['Hana Hidden', 'hana.example.com', 'other'])
    expect(a.bluesky).toMatchObject({ did: 'did:plc:hana', handleInvalid: true })
  })

  it('signedOutStatus hides a quote by a hidden author that reached it', () => {
    const hidden = hiddenAccount({ id: 'did:plc:hana', bluesky: { did: 'did:plc:hana', handleInvalid: false, labels: [
      { src: 'did:plc:hana', uri: 'x', val: '!no-unauthenticated', cts: '' },
    ] } } as Account)
    const visible = { id: 'v', account: { id: 'did:plc:alice', bluesky: { did: 'did:plc:alice', handleInvalid: false, labels: [] } } } as unknown as Status
    const quoted = { ...visible, quote: { state: 'accepted', quotedStatus: { id: 'q', account: hidden, content: 'secret' } } } as unknown as Status
    expect(signedOutStatus(quoted).quote).toEqual({ state: 'unauthorized', quotedStatus: null, bluesky: { hidden: 'no-unauthenticated' } })
    const repost = { ...visible, reblog: quoted } as Status
    expect(signedOutStatus(repost).reblog?.quote).toMatchObject({ bluesky: { hidden: 'no-unauthenticated' } })
  })
})
