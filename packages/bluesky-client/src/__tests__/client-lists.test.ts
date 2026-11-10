import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { describe, expect, it, vi } from 'vitest'
import { createBlueskyClient, type BlueskyAgent } from '../client.js'
import { BlueskyWriteUnknown } from '../errors.js'
import { fixture, moderationFor, READER } from './_helpers.js'

// Rules: README, "Lists (#195)".

const ME = 'did:plc:reader'
const LIST = 'app.bsky.graph.list'
const ITEM = 'app.bsky.graph.listitem'
const CURATE = 'app.bsky.graph.defs#curatelist'
const FRIENDS = '3lcurateaaaa2'
const FRIENDS_URI = `at://${ME}/${LIST}/${FRIENDS}`

// A valid TID for a number: `3l` and 11 letters.
const tid = (i: number) => `3l${i.toString(26).split('').map((d) => 'abcdefghijklmnopqrstuvwxyz'[parseInt(d, 26)]).join('').padStart(11, 'a')}`

interface Rec { uri: string; cid: string; value: Record<string, unknown> }
interface Page { records: Rec[]; cursor?: string }

function xrpcError(status: number, error: string, message = error) {
  return Object.assign(new Error(message), { status, error })
}

// A PDS in memory: the reader's repo, with the calls the lists make.
function fakePds() {
  const repo = new Map<string, Map<string, Rec>>()
  let n = 0
  const coll = (c: string) => {
    let m = repo.get(c)
    if (!m) repo.set(c, (m = new Map()))
    return m
  }
  const put = (collection: string, rkey: string, value: Record<string, unknown>): Rec => {
    const rec = { uri: `at://${ME}/${collection}/${rkey}`, cid: `bafyrec${++n}`, value }
    coll(collection).set(rkey, rec)
    return rec
  }
  const own = (r: string) => { if (r !== ME) throw xrpcError(400, 'InvalidRequest', 'not your repo') }
  const api = {
    listRecords: vi.fn(async (q: { repo: string; collection: string; limit?: number; cursor?: string }) => {
      own(q.repo)
      const all = [...coll(q.collection).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
      const from = q.cursor ? all.findIndex(([k]) => k < q.cursor!) : 0
      const rest = from < 0 ? [] : all.slice(from)
      const limit = q.limit ?? 50
      const records = rest.slice(0, limit).map(([, r]) => r)
      const page: Page = { records }
      if (rest.length > limit) page.cursor = records[records.length - 1]!.uri.split('/').pop()!
      return { data: page }
    }),
    getRecord: vi.fn(async (q: { repo: string; collection: string; rkey: string }) => {
      own(q.repo)
      const rec = coll(q.collection).get(q.rkey)
      if (!rec) throw xrpcError(400, 'RecordNotFound', 'Could not locate record')
      return { data: rec }
    }),
    createRecord: vi.fn(async (q: { repo: string; collection: string; rkey?: string; record: Record<string, unknown> }) => {
      own(q.repo)
      const rkey = q.rkey ?? `3lpds${++n}`
      if (coll(q.collection).has(rkey)) throw xrpcError(500, 'InternalServerError', 'There is already a value at key')
      const rec = put(q.collection, rkey, q.record)
      return { data: { uri: rec.uri, cid: rec.cid } }
    }),
    putRecord: vi.fn(async (q: { repo: string; collection: string; rkey: string; record: Record<string, unknown>; swapRecord?: string }) => {
      own(q.repo)
      const cur = coll(q.collection).get(q.rkey)
      if (q.swapRecord && cur?.cid !== q.swapRecord) throw xrpcError(400, 'InvalidSwap', 'Record was at another CID')
      const rec = put(q.collection, q.rkey, q.record)
      return { data: { uri: rec.uri, cid: rec.cid } }
    }),
    deleteRecord: vi.fn(async (q: { repo: string; collection: string; rkey: string }) => {
      own(q.repo)
      coll(q.collection).delete(q.rkey)
      return { data: {} }
    }),
    applyWrites: vi.fn(async (q: { repo: string; writes: { $type: string; collection: string; rkey: string }[] }) => {
      own(q.repo)
      if (q.writes.length > 200) throw xrpcError(400, 'InvalidRequest', 'Too many writes')
      for (const w of q.writes) {
        if (w.$type !== 'com.atproto.repo.applyWrites#delete') throw new Error(`unexpected write ${w.$type}`)
        coll(w.collection).delete(w.rkey)
      }
      return { data: {} }
    }),
    uploadBlob: vi.fn(),
  }
  return { repo, api, put, coll }
}

function seed(pds: ReturnType<typeof fakePds>) {
  const f = fixture<{ lists: Page; items: Page }>('list-records.json')
  for (const r of [...f.lists.records, ...f.items.records]) {
    const [, , , collection, rkey] = r.uri.split('/')
    pds.coll(collection!).set(rkey!, r)
  }
}

function profile(did: string, handle: string) {
  return { did, handle, displayName: handle.split('.')[0], viewer: {}, labels: [] }
}

function setup(opts: { rkeys?: string[]; seeded?: boolean } = {}) {
  const pds = fakePds()
  if (opts.seeded !== false) seed(pds)
  let t = 0
  const rkeys = opts.rkeys ?? []
  const nextRkey = vi.fn(() => rkeys.shift() ?? tid(1000 + ++t))
  const getListFeed = vi.fn(async (_q: { list: string; cursor?: string; limit?: number }) =>
    ({ data: fixture<{ feed: unknown[]; cursor?: string }>('feed-page.json'), headers: {} }))
  const agent = {
    did: ME,
    getProfiles: vi.fn(async ({ actors }: { actors: string[] }) => ({
      data: { profiles: actors.filter((a) => a !== 'did:plc:gone').map((a) => profile(a, `${a.split(':')[2]}.example.com`)) },
      headers: {},
    })),
    getPosts: vi.fn(), getProfile: vi.fn(),
    com: { atproto: { repo: pds.api, sync: { getBlob: vi.fn() } } },
    app: { bsky: { feed: { getListFeed }, graph: {}, bookmark: {} } },
  }
  const onUnauthorized = vi.fn()
  const client = createBlueskyClient({
    userKey: READER,
    agent: agent as unknown as BlueskyAgent,
    moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    onUnauthorized,
    compose: { nextRkey, detectFacets: async () => [] },
  })
  return { client, agent, pds, nextRkey, getListFeed, onUnauthorized }
}

describe('Bluesky lists: reads come from the PDS', () => {
  it('fetchLists answers only the curate lists, from listRecords on the reader repo', async () => {
    const { client, pds } = setup()
    const lists = await client.fetchLists()
    expect(lists).toEqual([{ id: FRIENDS, title: 'Friends', repliesPolicy: 'list', exclusive: false }])
    expect(pds.api.listRecords).toHaveBeenCalledWith(expect.objectContaining({ repo: ME, collection: LIST }))
  })

  it('fetchLists reads every page', async () => {
    const { client, pds } = setup({ seeded: false })
    for (let i = 0; i < 150; i++) {
      pds.put(LIST, tid(i), { $type: LIST, name: `L${i}`, purpose: CURATE, createdAt: '2024-01-01T00:00:00.000Z' })
    }
    expect((await client.fetchLists()).length).toBe(150)
    expect(pds.api.listRecords.mock.calls.length).toBeGreaterThan(1)
  })

  it('leaves out a record with no name or a key that is not a TID', async () => {
    const { client, pds } = setup({ seeded: false })
    pds.put(LIST, '3lgoodaaaaa22', { name: 'Good', purpose: CURATE, createdAt: 'x' })
    pds.put(LIST, '3lnonameaaa22', { purpose: CURATE, createdAt: 'x' })
    pds.put(LIST, '3lblankaaaa22', { name: '', purpose: CURATE, createdAt: 'x' })
    pds.put(LIST, 'self.key', { name: 'Odd key', purpose: CURATE, createdAt: 'x' })
    expect((await client.fetchLists()).map((l) => l.title)).toEqual(['Good'])
  })

  it('fetchList reads the record; missing or a mod list is not_found', async () => {
    const { client } = setup()
    expect(await client.fetchList(FRIENDS)).toMatchObject({ id: FRIENDS, title: 'Friends' })
    await expect(client.fetchList('3lmissingaa22')).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.fetchList('3lmodlistbbb2')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('fetchListAccounts: the list items, newest first, as moderated profiles; an unknown DID stays, with no decision', async () => {
    const { client, pds, agent } = setup()
    pds.put(ITEM, '3litemzzzzz22', { subject: 'did:plc:gone', list: FRIENDS_URI, createdAt: 'x' })
    pds.put(ITEM, '3litemaaaaa22', { subject: 'did:plc:alice', list: FRIENDS_URI, createdAt: 'x' }) // a second item for alice
    const members = await client.fetchListAccounts(FRIENDS)
    expect(members.map((a) => a.id)).toEqual(['did:plc:gone', 'did:plc:alice'])
    expect(members[1]!.bluesky?.moderation).toEqual(moderationFor('did:plc:alice'))
    expect(members[0]).toMatchObject({ id: 'did:plc:gone', acct: 'did:plc:gone', displayName: '', avatar: '' })
    expect(members[0]!.bluesky?.moderation).toBeUndefined()
    // The mod list's member is not read.
    expect(agent.getProfiles.mock.calls.flatMap((c) => c[0].actors)).not.toContain('did:plc:spammer')
  })

  it('fetchAccountLists: the curate lists that hold the DID', async () => {
    const { client } = setup()
    expect((await client.fetchAccountLists('did:plc:alice')).map((l) => l.id)).toEqual([FRIENDS])
    expect(await client.fetchAccountLists('did:plc:spammer')).toEqual([])
  })
})

describe('Bluesky lists: create', () => {
  it('writes one curate list record with a client-picked rkey', async () => {
    const { client, pds } = setup({ rkeys: ['3lnewlistaa22'] })
    const made = await client.createList({ title: '  Cats  ' })
    expect(pds.api.createRecord).toHaveBeenCalledTimes(1)
    expect(pds.api.createRecord).toHaveBeenCalledWith({
      repo: ME, collection: LIST, rkey: '3lnewlistaa22',
      record: { $type: LIST, purpose: CURATE, name: 'Cats', createdAt: expect.any(String) },
    })
    expect(made).toEqual({ id: '3lnewlistaa22', title: 'Cats', repliesPolicy: 'list', exclusive: false })
  })

  it('refuses an empty name or one over 64 bytes before any request', async () => {
    const { client, pds } = setup()
    await expect(client.createList({ title: '   ' })).rejects.toBeInstanceOf(CaribouError)
    await expect(client.createList({ title: '🌷'.repeat(17) })).rejects.toMatchObject({ userMessage: expect.any(String) })
    expect(pds.api.createRecord).not.toHaveBeenCalled()
    await expect(client.createList({ title: '🌷'.repeat(16) })).resolves.toMatchObject({ title: '🌷'.repeat(16) })
  })

  it('a lost answer: the record is read back, and found means done; no second record', async () => {
    const { client, pds } = setup({ rkeys: ['3lnewlistaa22'] })
    pds.api.createRecord.mockImplementationOnce(async (q) => {
      pds.put(q.collection, q.rkey!, q.record)
      throw xrpcError(502, 'BadGateway')
    })
    await expect(client.createList({ title: 'Cats' })).resolves.toMatchObject({ id: '3lnewlistaa22', title: 'Cats' })
    expect(pds.coll(LIST).size).toBe(4)
  })

  it('a lost answer with no record throws, and the next create of that name reuses the rkey', async () => {
    const { client, pds, nextRkey } = setup({ rkeys: ['3lnewlistaa22', '3lotherrkey22'] })
    pds.api.createRecord.mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch'), {}))
    await expect(client.createList({ title: 'Cats' })).rejects.toMatchObject({ code: 'unreachable' })
    const made = await client.createList({ title: 'Cats' })
    expect(made.id).toBe('3lnewlistaa22')
    expect(nextRkey).toHaveBeenCalledTimes(1)
  })

  it('a lost answer whose read-back fails is BlueskyWriteUnknown, and the rkey stays kept', async () => {
    const { client, pds } = setup({ rkeys: ['3lnewlistaa22', '3lotherrkey22'] })
    pds.api.createRecord.mockImplementationOnce(async (q) => {
      pds.put(q.collection, q.rkey!, q.record)
      throw xrpcError(504, 'GatewayTimeout')
    })
    pds.api.getRecord.mockRejectedValueOnce(xrpcError(503, 'Unavailable'))
    await expect(client.createList({ title: 'Cats' })).rejects.toBeInstanceOf(BlueskyWriteUnknown)
    // The next click finds the record the first one made.
    await expect(client.createList({ title: 'Cats' })).resolves.toMatchObject({ id: '3lnewlistaa22' })
    expect(pds.coll(LIST).size).toBe(4)
  })

  it('an answered 4xx is thrown as it is and forgets the rkey', async () => {
    const { client, pds } = setup({ rkeys: ['3lnewlistaa22', '3lotherrkey22'] })
    pds.api.createRecord.mockRejectedValueOnce(xrpcError(400, 'InvalidRecord'))
    await expect(client.createList({ title: 'Cats' })).rejects.toMatchObject({ code: 'unknown', status: 400 })
    expect(pds.api.getRecord).not.toHaveBeenCalled()
    await expect(client.createList({ title: 'Cats' })).resolves.toMatchObject({ id: '3lotherrkey22' })
  })

  it('without compose the lists cannot be written', async () => {
    const pds = fakePds()
    const client = createBlueskyClient({
      userKey: READER,
      agent: { did: ME, com: { atproto: { repo: pds.api } }, app: { bsky: {} } } as unknown as BlueskyAgent,
      moderation: { post: (v) => moderationFor(v.uri), profile: (v) => moderationFor(v.did) },
    })
    await expect(client.createList({ title: 'Cats' })).rejects.toMatchObject({ code: 'not_found' })
    expect(pds.api.createRecord).not.toHaveBeenCalled()
  })
})

describe('Bluesky lists: rename', () => {
  it('keeps every other field and swaps on the CID it read', async () => {
    const { client, pds } = setup()
    const saved = await client.updateList(FRIENDS, { title: 'Close friends', repliesPolicy: 'none', exclusive: true })
    expect(pds.api.putRecord).toHaveBeenCalledWith({
      repo: ME, collection: LIST, rkey: FRIENDS, swapRecord: 'bafyreicuratelist',
      record: {
        $type: LIST, name: 'Close friends', purpose: CURATE, description: 'People I know',
        createdAt: '2024-05-01T10:00:00.000Z',
      },
    })
    expect(saved).toEqual({ id: FRIENDS, title: 'Close friends', repliesPolicy: 'list', exclusive: false })
  })

  it('a change made elsewhere in between fails the save', async () => {
    const { client, pds } = setup()
    pds.api.getRecord.mockImplementationOnce(async (q) => {
      const rec = pds.coll(q.collection).get(q.rkey)!
      pds.put(q.collection, q.rkey, { ...rec.value, description: 'changed elsewhere' })
      return { data: rec }
    })
    await expect(client.updateList(FRIENDS, { title: 'New' })).rejects.toMatchObject({ status: 400 })
    expect(pds.coll(LIST).get(FRIENDS)!.value.name).toBe('Friends')
  })

  it('a lost answer: the record is read; the new name means done', async () => {
    const { client, pds } = setup()
    pds.api.putRecord.mockImplementationOnce(async (q) => {
      pds.put(q.collection, q.rkey, q.record)
      throw xrpcError(500, 'InternalServerError')
    })
    await expect(client.updateList(FRIENDS, { title: 'New' })).resolves.toMatchObject({ title: 'New' })
  })

  it('a lost answer with the old name still there throws', async () => {
    const { client, pds } = setup()
    pds.api.putRecord.mockRejectedValueOnce(xrpcError(500, 'InternalServerError'))
    await expect(client.updateList(FRIENDS, { title: 'New' })).rejects.toMatchObject({ code: 'server_error' })
  })

  it('refuses a mod list', async () => {
    const { client, pds } = setup()
    await expect(client.updateList('3lmodlistbbb2', { title: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    expect(pds.api.putRecord).not.toHaveBeenCalled()
  })
})

describe('Bluesky lists: delete', () => {
  it('deletes the list and its items in one call, list last; other lists keep theirs', async () => {
    const { client, pds } = setup()
    await client.deleteList(FRIENDS)
    expect(pds.api.applyWrites).toHaveBeenCalledTimes(1)
    const writes = pds.api.applyWrites.mock.calls[0]![0].writes
    expect(writes).toEqual([
      { $type: 'com.atproto.repo.applyWrites#delete', collection: ITEM, rkey: '3litemalice22' },
      { $type: 'com.atproto.repo.applyWrites#delete', collection: LIST, rkey: FRIENDS },
    ])
    expect(pds.coll(LIST).has(FRIENDS)).toBe(false)
    expect(pds.coll(ITEM).has('3litemspam222')).toBe(true)
  })

  it('batches at 200 writes, the list in the last batch', async () => {
    const { client, pds } = setup({ seeded: false })
    pds.put(LIST, FRIENDS, { name: 'Big', purpose: CURATE, createdAt: 'x' })
    for (let i = 0; i < 250; i++) pds.put(ITEM, tid(i), { subject: `did:plc:m${i}`, list: FRIENDS_URI, createdAt: 'x' })
    await client.deleteList(FRIENDS)
    const calls = pds.api.applyWrites.mock.calls.map((c) => c[0].writes)
    expect(calls.map((w) => w.length)).toEqual([200, 51])
    expect(calls[1]!.at(-1)).toMatchObject({ collection: LIST, rkey: FRIENDS })
    expect(pds.coll(ITEM).size).toBe(0)
  })

  it('in doubt: gone means done; still there throws; a failed read is unknown', async () => {
    const a = setup()
    a.pds.api.applyWrites.mockImplementationOnce(async (q) => {
      for (const w of q.writes) a.pds.coll(w.collection).delete(w.rkey)
      throw xrpcError(502, 'BadGateway')
    })
    await expect(a.client.deleteList(FRIENDS)).resolves.toBeUndefined()

    const b = setup()
    b.pds.api.applyWrites.mockRejectedValueOnce(xrpcError(502, 'BadGateway'))
    await expect(b.client.deleteList(FRIENDS)).rejects.toMatchObject({ code: 'server_error' })

    const c = setup()
    c.pds.api.applyWrites.mockImplementationOnce(async () => {
      // The read that decides it fails.
      c.pds.api.getRecord.mockRejectedValueOnce(xrpcError(503, 'Unavailable'))
      throw xrpcError(502, 'BadGateway')
    })
    await expect(c.client.deleteList(FRIENDS)).rejects.toBeInstanceOf(BlueskyWriteUnknown)
  })

  it('an answered 4xx is thrown as it is', async () => {
    const { client, pds } = setup()
    pds.api.applyWrites.mockRejectedValueOnce(xrpcError(400, 'InvalidRequest'))
    await expect(client.deleteList(FRIENDS)).rejects.toMatchObject({ status: 400 })
    // Only the read before the write; no read to decide it.
    expect(pds.api.getRecord).toHaveBeenCalledTimes(1)
  })

  it('refuses a mod list', async () => {
    const { client, pds } = setup()
    await expect(client.deleteList('3lmodlistbbb2')).rejects.toMatchObject({ code: 'not_found' })
    expect(pds.api.applyWrites).not.toHaveBeenCalled()
  })
})

describe('Bluesky lists: members', () => {
  it('add writes one listitem record per DID with a client-picked rkey; no follow needed', async () => {
    const { client, pds } = setup({ rkeys: ['3lnewitemaa22'] })
    await client.addListAccounts(FRIENDS, ['did:plc:bob'])
    expect(pds.api.createRecord).toHaveBeenCalledWith({
      repo: ME, collection: ITEM, rkey: '3lnewitemaa22',
      record: { $type: ITEM, subject: 'did:plc:bob', list: FRIENDS_URI, createdAt: expect.any(String) },
    })
  })

  it('add: a lost answer is read back; found means done', async () => {
    const { client, pds } = setup({ rkeys: ['3lnewitemaa22'] })
    pds.api.createRecord.mockImplementationOnce(async (q) => {
      pds.put(q.collection, q.rkey!, q.record)
      throw xrpcError(500, 'InternalServerError')
    })
    await expect(client.addListAccounts(FRIENDS, ['did:plc:bob'])).resolves.toBeUndefined()
    expect([...pds.coll(ITEM).values()].filter((r) => r.value.subject === 'did:plc:bob')).toHaveLength(1)
  })

  it('add refuses a list that is not a curate list of the reader', async () => {
    const { client, pds } = setup()
    await expect(client.addListAccounts('3lmodlistbbb2', ['did:plc:bob'])).rejects.toMatchObject({ code: 'not_found' })
    expect(pds.api.createRecord).not.toHaveBeenCalled()
  })

  it('remove deletes every item of that list for the DID, and nothing else', async () => {
    const { client, pds } = setup()
    pds.put(ITEM, '3litemaaaaa22', { subject: 'did:plc:alice', list: FRIENDS_URI, createdAt: 'x' })
    pds.put(ITEM, '3litemother22', { subject: 'did:plc:alice', list: `at://${ME}/${LIST}/3lotherlist22`, createdAt: 'x' })
    await client.removeListAccounts(FRIENDS, ['did:plc:alice'])
    expect(pds.api.applyWrites).toHaveBeenCalledTimes(1)
    expect(pds.api.applyWrites.mock.calls[0]![0].writes.map((w) => w.rkey).sort()).toEqual(['3litemaaaaa22', '3litemalice22'])
    expect(pds.coll(ITEM).has('3litemother22')).toBe(true)
    expect(pds.coll(ITEM).has('3litemspam222')).toBe(true)
  })

  it('remove with no item is done and writes nothing', async () => {
    const { client, pds } = setup()
    await expect(client.removeListAccounts(FRIENDS, ['did:plc:bob'])).resolves.toBeUndefined()
    expect(pds.api.applyWrites).not.toHaveBeenCalled()
  })

  it('remove in doubt: no item left means done; one left throws; a failed read is unknown', async () => {
    const a = setup()
    a.pds.api.applyWrites.mockImplementationOnce(async (q) => {
      for (const w of q.writes) a.pds.coll(w.collection).delete(w.rkey)
      throw xrpcError(500, 'InternalServerError')
    })
    await expect(a.client.removeListAccounts(FRIENDS, ['did:plc:alice'])).resolves.toBeUndefined()

    const b = setup()
    b.pds.api.applyWrites.mockRejectedValueOnce(xrpcError(500, 'InternalServerError'))
    await expect(b.client.removeListAccounts(FRIENDS, ['did:plc:alice'])).rejects.toMatchObject({ code: 'server_error' })

    const c = setup()
    c.pds.api.applyWrites.mockRejectedValueOnce(xrpcError(500, 'InternalServerError'))
    const listRecords = c.pds.api.listRecords.getMockImplementation()!
    let calls = 0
    c.pds.api.listRecords.mockImplementation(async (q) => {
      if (q.collection === ITEM && ++calls > 1) throw xrpcError(503, 'Unavailable')
      return listRecords(q)
    })
    await expect(c.client.removeListAccounts(FRIENDS, ['did:plc:alice'])).rejects.toBeInstanceOf(BlueskyWriteUnknown)
  })
})

describe('Bluesky lists: the list feed', () => {
  it('reads getListFeed with the list URI and maps the posts with the reader decision', async () => {
    const { client, getListFeed } = setup()
    const page = await client.fetchTimeline({ type: 'list', id: FRIENDS }, { cursor: 'c1', limit: 20 })
    expect(getListFeed).toHaveBeenCalledWith({ list: FRIENDS_URI, cursor: 'c1', limit: 20 })
    expect(page.length).toBeGreaterThan(0)
    expect(page[0]!.bluesky?.viewerOf).toBe(READER)
    expect(page[0]!.bluesky?.moderation).toBeDefined()
  })

  it('a catch-up pages from the top until it meets the known entry', async () => {
    const { client, getListFeed } = setup()
    const first = await client.fetchTimeline({ type: 'list', id: FRIENDS })
    const top = first[1]!.id
    const caught = await client.fetchTimeline({ type: 'list', id: FRIENDS }, { sinceId: top })
    expect(caught.nextCursor).toBeNull()
    expect(caught.map((s) => s.id)).toEqual(first.slice(0, 2).map((s) => s.id))
    expect(getListFeed).toHaveBeenLastCalledWith(expect.objectContaining({ list: FRIENDS_URI, limit: 50 }))
  })

  it('refuses an id that is not a TID before any request', async () => {
    const { client, getListFeed } = setup()
    await expect(client.fetchTimeline({ type: 'list', id: '../x' })).rejects.toMatchObject({ code: 'not_found' })
    expect(getListFeed).not.toHaveBeenCalled()
  })
})

describe('Bluesky lists: errors', () => {
  it('a 401 calls onUnauthorized', async () => {
    const { client, pds, onUnauthorized } = setup()
    pds.api.listRecords.mockRejectedValueOnce(xrpcError(401, 'AuthMissing'))
    await expect(client.fetchLists()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
