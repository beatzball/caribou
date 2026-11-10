// @vitest-environment jsdom
import { Agent } from '@atproto/api'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Capabilities, Status } from '@beatzball/caribou-mastodon-client'
import {
  _testOnlyResetActAs, actAs, activeUserKey, blueskyUserKey, markExpired, saveToStorage, setBlueskyDriver, statusCache,
  users, type BlueskyDriver, type BlueskySession,
} from '@beatzball/caribou-state'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { moderationFor } from './_helpers.js'

// State README, "Act as another account", rules 3 and 5, against the real
// client and the real SDK agent: what goes on the wire, not button state.

const ALICE = blueskyUserKey('did:plc:alice')
const BOB = blueskyUserKey('did:plc:bob')
const POST = 'at://did:plc:erin/app.bsky.feed.post/3kpost'
const CAPS = { network: 'bluesky', readLagMs: 60_000 } as unknown as Capabilities
const VIEW = { favourited: false, reblogged: false, bookmarked: false, likeUri: null, repostUri: null }

function session(name: string): BlueskySession {
  return {
    network: 'bluesky', userKey: blueskyUserKey(`did:plc:${name}`), did: `did:plc:${name}`,
    handle: `${name}.example.com`, pds: `https://${name}.pds.example.test`, generation: `G-${name}`,
    account: null, createdAt: 1,
  }
}

interface Sent { host: string; path: string; body: Record<string, unknown> | null }
let sent: Sent[] = []
let status = 200

// The JSON the SDK sent, whatever form the body took.
async function bodyOf(init: RequestInit): Promise<Record<string, unknown> | null> {
  if (init.body == null) return null
  const text = await new Response(init.body as BodyInit).text()
  return text ? JSON.parse(text) as Record<string, unknown> : null
}

// The OAuth session the SDK would restore: a fetch handler bound to the
// account's own PDS. Every request is recorded.
function driver(): BlueskyDriver {
  return {
    capabilities: CAPS,
    timelineOrder: () => null,
    async restore(s, hooks) {
      const agent = new Agent({
        did: s.did,
        fetchHandler: async (path: string, init: RequestInit) => {
          const url = new URL(path, s.pds)
          const body = await bodyOf(init)
          sent.push({ host: url.host, path: url.pathname, body })
          if (status !== 200) {
            return new Response(JSON.stringify({ error: 'InvalidToken', message: 'gone' }), { status, headers: { 'content-type': 'application/json' } })
          }
          const repo = (body?.repo as string | undefined) ?? s.did
          const collection = body?.collection as string | undefined
          const out = collection ? { uri: `at://${repo}/${collection}/3knew`, cid: 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm' } : {}
          return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
        },
      })
      return createBlueskyClient({
        userKey: s.userKey,
        agent: agent as unknown as BlueskyAgent,
        moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
        onUnauthorized: hooks.onExpired,
      })
    },
    signOut: async () => {},
  }
}

const post = { id: POST, bluesky: { uri: POST, cid: 'bafypost', likeUri: null, repostUri: null } } as unknown as Status

const onExpired = (e: Event) => {
  const d = (e as CustomEvent<{ userKey: string; generation: string }>).detail
  markExpired(d.userKey as never, d.generation)
}

beforeEach(() => {
  sent = []
  status = 200
  localStorage.clear()
  statusCache.value = new Map()
  users.value = new Map([[ALICE, session('alice')], [BOB, session('bob')]])
  activeUserKey.value = ALICE
  saveToStorage()
  _testOnlyResetActAs()
  setBlueskyDriver(driver())
  window.addEventListener('caribou:session-expired', onExpired)
})
afterEach(() => {
  window.removeEventListener('caribou:session-expired', onExpired)
  setBlueskyDriver(null)
})

describe('act as bob, on the wire', () => {
  it('a like goes to bob PDS, and the record is in bob repo with the post URI and CID as is', async () => {
    const out = await actAs(BOB, 'favourite', post, VIEW)
    expect(sent).toEqual([{
      host: 'bob.pds.example.test',
      path: '/xrpc/com.atproto.repo.createRecord',
      body: {
        repo: 'did:plc:bob', collection: 'app.bsky.feed.like',
        record: { $type: 'app.bsky.feed.like', subject: { uri: POST, cid: 'bafypost' }, createdAt: expect.any(String) },
      },
    }])
    expect(out).toEqual({ kind: 'ok', view: { ...VIEW, favourited: true, likeUri: 'at://did:plc:bob/app.bsky.feed.like/3knew' } })
  })

  it('a repost and a bookmark go to bob PDS too', async () => {
    await actAs(BOB, 'reblog', post, VIEW)
    await actAs(BOB, 'bookmark', post, VIEW)
    expect(sent.map((s) => [s.host, s.path, s.body?.repo])).toEqual([
      ['bob.pds.example.test', '/xrpc/com.atproto.repo.createRecord', 'did:plc:bob'],
      ['bob.pds.example.test', '/xrpc/app.bsky.bookmark.createBookmark', undefined],
    ])
    expect(sent[1]!.body).toEqual({ uri: POST, cid: 'bafypost' })
  })

  it('an undo deletes bob like record in bob repo', async () => {
    await actAs(BOB, 'favourite', post, { ...VIEW, favourited: true, likeUri: 'at://did:plc:bob/app.bsky.feed.like/3kold' })
    expect(sent).toEqual([{
      host: 'bob.pds.example.test',
      path: '/xrpc/com.atproto.repo.deleteRecord',
      body: { repo: 'did:plc:bob', collection: 'app.bsky.feed.like', rkey: '3kold' },
    }])
  })

  it('nothing goes to the active account PDS', async () => {
    await actAs(BOB, 'favourite', post, VIEW)
    expect(sent.some((s) => s.host === 'alice.pds.example.test')).toBe(false)
  })

  it('a 401 marks bob expired; the next try sends nothing', async () => {
    status = 401
    expect(await actAs(BOB, 'favourite', post, VIEW)).toEqual({ kind: 'expired' })
    expect(users.value.get(BOB)!.expired).toBe(true)
    expect(users.value.get(ALICE)!.expired).toBeUndefined()
    sent = []
    status = 200
    expect(await actAs(BOB, 'favourite', post, VIEW)).toEqual({ kind: 'expired' })
    expect(sent).toEqual([])
  })
})
