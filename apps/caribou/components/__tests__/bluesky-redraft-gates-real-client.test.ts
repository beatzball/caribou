// #262: a redraft through the real Bluesky client, over a fake PDS. A reply
// rule the composer cannot send (another repo's list, an unknown rule) is
// named in the confirm before the delete, and the draft posts.
// Rules: packages/state README, "Limits a redraft keeps".
import { beforeEach, describe, expect, it } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '@beatzball/caribou-bluesky-client/browser'
import type { Status } from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, deleteOwnStatusOutcome, loadDraft, postBlueskyDraft, readBlueskyRedraft, redraftDropsGates,
  settleBlueskyRedraft, storeBlueskyRedraft,
} from '@beatzball/caribou-state'

const DID = 'did:plc:reader'
const KEY = `${DID}@bsky` as const
const POST = 'app.bsky.feed.post'
const TG = 'app.bsky.feed.threadgate'
const OLD = '3koldkey00001'
const NEW = '3knewkey00001'
const URI = `at://${DID}/${POST}/${OLD}`
const RECORD = { $type: POST, text: 'hello world', createdAt: '2026-11-10T00:00:00.000Z' }
const FOREIGN_LIST = 'at://did:plc:bob/app.bsky.graph.list/3kllaaaaaaaa2'

type Write = { $type: string; collection: string; rkey: string; value?: Record<string, unknown> }

function pds(allow: unknown[]) {
  let present = true
  const batches: Write[][] = []
  const repo = {
    async getRecord({ collection, rkey }: { collection: string; rkey: string }) {
      if (present && rkey === OLD && collection === POST) return { data: { uri: URI, cid: 'bafyold', value: RECORD } }
      if (present && rkey === OLD && collection === TG) {
        return { data: { uri: `at://${DID}/${TG}/${OLD}`, value: { $type: TG, post: URI, createdAt: RECORD.createdAt, allow } } }
      }
      throw Object.assign(new Error('Could not locate record'), { status: 400, error: 'RecordNotFound' })
    },
    async applyWrites({ writes }: { writes: Write[] }) {
      batches.push(writes)
      if (writes[0]!.$type.endsWith('#delete')) {
        present = false
        return { data: { results: writes.map(() => ({ $type: 'com.atproto.repo.applyWrites#deleteResult' })) } }
      }
      return { data: { results: writes.map((w) => ({ uri: `at://${DID}/${w.collection}/${w.rkey}`, cid: 'bafynew' })) } }
    },
  }
  const client = createBlueskyClient({
    userKey: KEY,
    agent: { did: DID, com: { atproto: { repo } } } as unknown as BlueskyAgent,
    moderation: {} as never,
    compose: { nextRkey: () => NEW, detectFacets: async () => [] },
  })
  return { client, batches }
}

const status = { id: URI, uri: URI, bluesky: { uri: URI, cid: 'bafyold' } } as unknown as Status

describe('redraft of a post whose limits the composer cannot send (#262)', () => {
  beforeEach(() => {
    localStorage.clear()
    activeUserKey.value = KEY
  })

  it.each([
    ['another repo\'s list', { $type: `${TG}#listRule`, list: FOREIGN_LIST }],
    ['an unknown rule', { $type: `${TG}#someNewRule` }],
  ])('%s: the confirm is told before the delete, and the draft posts', async (_, rule) => {
    const { client, batches } = pds([{ $type: `${TG}#followingRule` }, rule])
    const source = (await readBlueskyRedraft(client, status))!
    // The confirm says "Its reply and quote limits are not kept." before any write.
    expect(redraftDropsGates(source)).toBe(true)
    expect(batches).toEqual([])

    const stored = (await storeBlueskyRedraft(client, source, { prepareImage: async () => null }))!
    const outcome = await deleteOwnStatusOutcome(client, status)
    expect(outcome.kind).toBe('deleted')
    expect(batches).toHaveLength(1)
    const slot = (await settleBlueskyRedraft(stored, 'deleted'))!
    const draft = loadDraft(KEY, slot)!
    expect(draft.bluesky!.gates).toEqual({ replies: [{ kind: 'following' }], quotes: true })

    await expect(postBlueskyDraft(client, slot, draft)).resolves.toMatchObject({ kind: 'posted' })
    const sent = batches.at(-1)!
    expect(sent.map((w) => w.collection)).toEqual([POST, TG])
    expect(sent[1]!.value).toMatchObject({ post: `at://${DID}/${POST}/${NEW}`, allow: [{ $type: `${TG}#followingRule` }] })
  })
})
