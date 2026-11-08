// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fx from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'
import {
  blueskySsrEnabled, failClosedLabels, fetchBlueskyProfilePage, fetchBlueskyThread, publicAppView,
  signedOutStatus, validActor, validRecordKey,
} from '../../server/lib/bluesky-public.js'

// Every test gets its own AppView origin, so the module's cache never
// answers one test with another's data.
let origin = ''
let seq = 0
let calls: string[] = []
let failMethods = new Set<string>()

beforeEach(() => {
  origin = `http://appview-${++seq}.test`
  process.env.BLUESKY_PUBLIC_APPVIEW = origin
  calls = []
  failMethods = new Set()
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    calls.push(input)
    const url = new URL(input)
    const method = url.pathname.replace('/xrpc/', '')
    const { status, body } = failMethods.has(method)
      ? { status: 503, body: {} }
      : fx.appviewAnswer(method, url.searchParams)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.BLUESKY_PUBLIC_APPVIEW
})

const json = (v: unknown) => JSON.stringify(v)

function expectNone(v: unknown, secrets: readonly string[]) {
  const text = json(v)
  for (const s of secrets) expect(text, s).not.toContain(s)
}

describe('config and syntax', () => {
  it('reads the server flag and the AppView origin', () => {
    expect(blueskySsrEnabled({})).toBe(false)
    expect(blueskySsrEnabled({ BLUESKY_SSR: '1' })).toBe(true)
    expect(publicAppView({})).toBe('https://public.api.bsky.app')
    expect(publicAppView({ BLUESKY_PUBLIC_APPVIEW: 'http://127.0.0.1:9/x/' })).toBe('http://127.0.0.1:9')
    expect(publicAppView({ BLUESKY_PUBLIC_APPVIEW: 'file:///etc/passwd' })).toBe('https://public.api.bsky.app')
  })

  it.each([
    ['alice.example.com', true], ['did:plc:alice', true], ['did:web:example.com', true],
    ['-bad.example.com', false], ['a..b', false], ['did:bad', false], ['did:plc:', false], ['x'.repeat(300) + '.com', false],
  ])('validActor(%s) is %s', (actor, ok) => {
    expect(validActor(actor)).toBe(ok)
  })

  it('checks a record key', () => {
    expect(validRecordKey('3kalicefocus')).toBe(true)
    expect(validRecordKey('..')).toBe(false)
    expect(validRecordKey('a/b')).toBe(false)
  })
})

describe('failClosedLabels', () => {
  it('adds the label to an author with no labels array, and leaves one that has it', () => {
    const out = failClosedLabels({ a: fx.nora as typeof fx.nora & { labels?: { src: string; val: string }[] }, b: fx.alice })
    expect(out.a.labels?.[0]).toMatchObject({ src: 'did:plc:nora', val: '!no-unauthenticated' })
    expect(out.b.labels).toEqual([])
    // The input is not changed.
    expect('labels' in fx.nora).toBe(false)
  })
})

describe('fetchBlueskyProfilePage', () => {
  it('maps a visible profile with moderation, no viewer state, and the first cursor', async () => {
    const page = await fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })
    if (page.kind !== 'ok') throw new Error('expected ok')
    expect(page.account).toMatchObject({ id: 'did:plc:alice', acct: 'alice.example.com', displayName: 'Alice Visible' })
    expect(page.account.bluesky?.moderation?.contexts.avatar).toBeDefined()
    expect(page.nextCursor).toBe('cursor-page-2')
    expect(page.statuses.every((s) => s.bluesky?.viewerOf === null && !s.favourited && !s.reblogged)).toBe(true)
    expect(json(page)).toContain('alice plain post')
    // Only the AppView is asked.
    expect(calls.every((u) => u.startsWith(`${origin}/xrpc/`))).toBe(true)
    expect(calls.some((u) => u.includes('getAuthorFeed') && u.includes('filter=posts_no_replies') && u.includes('includePins=false'))).toBe(true)
  })

  it('passes the cursor on and reads page two', async () => {
    const page = await fetchBlueskyProfilePage('did:plc:alice', { tab: 'posts', cursor: 'cursor-page-2' })
    if (page.kind !== 'ok') throw new Error('expected ok')
    expect(page.statuses.map((s) => s.content)).toEqual([expect.stringContaining('alice page two post')])
    expect(page.nextCursor).toBeNull()
  })

  it('hides a profile with the label, and does not fetch its posts', async () => {
    expect(await fetchBlueskyProfilePage('hana.example.com', { tab: 'posts' })).toEqual({ kind: 'hidden' })
    expect(calls.some((u) => u.includes('getAuthorFeed'))).toBe(false)
  })

  it('hides a profile whose labels were not read (fail closed)', async () => {
    expect(await fetchBlueskyProfilePage('nora.example.com', { tab: 'posts' })).toEqual({ kind: 'hidden' })
  })

  it('throws on an AppView error', async () => {
    await expect(fetchBlueskyProfilePage(fx.BROKEN_HANDLE, { tab: 'posts' })).rejects.toThrow()
  })

  describe('a hidden author in a visible profile (spec 8.3, per author)', () => {
    async function page() {
      const p = await fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })
      if (p.kind !== 'ok') throw new Error('expected ok')
      return p
    }

    it('none of hana\'s or nora\'s strings are in the data', async () => {
      const p = await page()
      expectNone(p, fx.HANA_SECRETS)
      expectNone(p, fx.NORA_SECRETS)
    })

    it('a repost of a hidden author keeps only its id, time and the hidden mark', async () => {
      const p = await page()
      const item = p.statuses.find((s) => s.id === 'at://did:plc:alice/app.bsky.feed.repost/3krp1')!
      expect(item.reblog).toBeNull()
      expect(item.content).toBe('')
      expect(item.account).toMatchObject({ id: 'did:plc:hana', acct: '', displayName: '', avatar: '' })
      expect(item.account.bluesky?.labels?.map((l) => l.val)).toEqual(['!no-unauthenticated'])
    })

    it('a repost by a hidden reposter is hidden whole', async () => {
      const p = await page()
      const item = p.statuses.find((s) => s.id === 'at://did:plc:hana/app.bsky.feed.repost/3krp3')!
      expect(item.reblog).toBeNull()
      expect(item.account.id).toBe('did:plc:hana')
      expect(json(item)).not.toContain('alice post hana reposted')
    })

    it('an author whose labels were not read is hidden (fail closed)', async () => {
      const p = await page()
      const item = p.statuses.find((s) => s.id === 'at://did:plc:alice/app.bsky.feed.repost/3krp2')!
      expect(item.account.id).toBe('did:plc:nora')
      expect(item.content).toBe('')
    })

    it('a quoted post by a hidden author is the quote notice', async () => {
      const p = await page()
      const item = p.statuses.find((s) => s.content.includes('alice quoting hana'))!
      expect(item.quote).toEqual({ state: 'unauthorized', quotedStatus: null, bluesky: { hidden: 'no-unauthenticated' } })
    })

    it('a record card by a hidden creator is the notice card', async () => {
      const p = await page()
      const item = p.statuses.find((s) => s.content.includes('alice sharing a list'))!
      expect(item.bluesky?.recordCard).toMatchObject({ title: 'This account asked to be seen only by signed-in readers.', image: null, description: '' })
    })

    it('the parent and root of a reply are not in the data', async () => {
      const p = await page()
      const item = p.statuses.find((s) => s.content.includes('alice replying to hana'))!
      expect(item.inReplyToAccountId).toBe('did:plc:hana')
      expectNone(item, ['hana parent post', 'hana root post'])
    })
  })

  it('control: a visible author\'s strings are all there', async () => {
    const p = await fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })
    const text = json(p)
    for (const s of ['Alice Visible', 'alice.example.com', 'Alice bio text', 'https://cdn.example.com/alice-avatar.jpg', 'alice plain post']) {
      expect(text).toContain(s)
    }
  })
})

describe('fetchBlueskyThread', () => {
  it('flattens the thread, hiding each hidden author\'s post as the notice and keeping the rest', async () => {
    const t = await fetchBlueskyThread('alice.example.com', '3kalicefocus')
    expect(t.focused.content).toContain('alice thread focus')
    // root (hana), parent (bob) — oldest first.
    expect(t.ancestors.map((s) => s.account.id)).toEqual(['did:plc:hana', 'did:plc:bob'])
    expect(t.ancestors[0]!.content).toBe('')
    expect(t.ancestors[1]!.content).toContain('bob parent post')
    expect(t.descendants.map((s) => s.account.id)).toEqual(['did:plc:hana', 'did:plc:carol'])
    expect(t.descendants[0]!.inReplyToId).toBe(fx.threadFocus.uri)
    expectNone(t, fx.HANA_SECRETS)
  })

  it('hides a focused post by a hidden author; its replies stay', async () => {
    const t = await fetchBlueskyThread('hana.example.com', '3khanafocus')
    expect(t.focused).toMatchObject({ id: fx.hanaFocus.uri, content: '', account: { acct: '' } })
    expect(t.descendants[0]!.content).toContain('carol reply to hana')
    expectNone(t, fx.HANA_SECRETS)
  })

  it('runs logged-out moderation: an adult label covers the media with no Show', async () => {
    const t = await fetchBlueskyThread('did:plc:alice', '3kaliceadult')
    const media = t.focused.bluesky!.moderation.contexts.contentMedia
    expect(media).toMatchObject({ blur: true, noOverride: true })
    expect(media.reasons.map((r) => r.label)).toEqual(['porn'])
  })

  it('covers a label it cannot define: unknown with definitions, labeler unavailable without (fail closed)', async () => {
    const loaded = await fetchBlueskyThread('did:plc:alice', '3kalicecustom')
    expect(loaded.focused.bluesky!.moderation.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
    expect(loaded.focused.bluesky!.moderation.contexts.contentView.reasons[0]!.name).toBe('Content warning (unknown label)')
    process.env.BLUESKY_PUBLIC_APPVIEW = `${origin}-nodefs`
    failMethods.add('app.bsky.labeler.getServices')
    const failed = await fetchBlueskyThread('did:plc:alice', '3kalicecustom')
    expect(failed.focused.bluesky!.moderation.contexts.contentView).toMatchObject({ blur: true, noOverride: true })
    expect(failed.focused.bluesky!.moderation.contexts.contentView.reasons[0]!.name).toBe('Content warning (labeler unavailable)')
  })

  it('throws when the post is not there', async () => {
    await expect(fetchBlueskyThread('alice.example.com', '3knothere')).rejects.toThrow()
  })
})

describe('signedOutStatus', () => {
  it('leaves a visible post as it is', async () => {
    const p = await fetchBlueskyProfilePage('alice.example.com', { tab: 'posts' })
    if (p.kind !== 'ok') throw new Error('expected ok')
    const plain = p.statuses.find((s) => s.content.includes('alice plain post'))!
    expect(signedOutStatus(plain)).toEqual(plain)
  })
})
