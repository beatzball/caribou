// What the public AppView answers for the SSR tests (app README, "Bluesky
// SSR"): profiles, author feeds, threads and Bluesky's label definitions.
// Placeholder accounts only. Plain data, so a unit test and the e2e
// fixture server (`apps/caribou/tests/e2e/_appview-stub.ts`) share it.
//
// Accounts:
// - alice: visible. Her profile and threads hold every place another
//   author's content can appear.
// - hana: `!no-unauthenticated`. Every string of hers is in `HANA_SECRETS`.
// - nora: no `labels` array at all (fail closed: hidden). `NORA_SECRETS`.
// - bob, carol: visible.

const CTS = '2026-01-01T00:00:00.000Z'
export const BSKY_LABELER = 'did:plc:ar7c4by46qjdydhdevvrndac'

const noUnauth = (did: string) => ({ src: did, uri: `at://${did}/app.bsky.actor.profile/self`, val: '!no-unauthenticated', cts: CTS })

export const alice = {
  did: 'did:plc:alice', handle: 'alice.example.com', displayName: 'Alice Visible',
  avatar: 'https://cdn.example.com/alice-avatar.jpg', labels: [],
}
export const bob = { did: 'did:plc:bob', handle: 'bob.example.com', displayName: 'Bob Visible', labels: [] }
export const carol = { did: 'did:plc:carol', handle: 'carol.example.com', displayName: 'Carol Visible', labels: [] }
export const hana = {
  did: 'did:plc:hana', handle: 'hana.example.com', displayName: 'Hana Hidden',
  avatar: 'https://cdn.example.com/hana-avatar.jpg', labels: [noUnauth('did:plc:hana')],
}
// No `labels` key: the server never read her labels.
export const nora = {
  did: 'did:plc:nora', handle: 'nora.example.com', displayName: 'Nora Unread',
  avatar: 'https://cdn.example.com/nora-avatar.jpg',
}

// `labels: null`: the server cannot prove her labels were read.
export const pia = {
  did: 'did:plc:pia', handle: 'pia.example.com', displayName: 'Pia Nulllabels',
  avatar: 'https://cdn.example.com/pia-avatar.jpg', labels: null,
}
// `labels` is not an array.
export const quin = {
  did: 'did:plc:quin', handle: 'quin.example.com', displayName: 'Quin Oddlabels',
  avatar: 'https://cdn.example.com/quin-avatar.jpg', labels: { val: 'not a list' },
}

/** Every string from an author or record whose labels were not read (fail closed). */
export const PARTIAL_SECRETS = [
  'Pia Nulllabels', 'pia.example.com', 'https://cdn.example.com/pia-avatar.jpg', 'pia null labels post', 'pia thread reply',
  'Quin Oddlabels', 'quin.example.com', 'https://cdn.example.com/quin-avatar.jpg', 'alice post quin reposted',
  'partial list name', 'partial list description', 'creatorless feed name', 'creatorless feed description',
  'https://cdn.example.com/creatorless-avatar.jpg', 'Pia bio text', 'Quin bio text',
]

/** Every string of hana's that must appear nowhere in a signed-out response. */
export const HANA_SECRETS = [
  'Hana Hidden', 'hana.example.com', 'https://cdn.example.com/hana-avatar.jpg',
  'https://cdn.example.com/hana-banner.jpg', 'Hana bio text',
  'hana reposted post', 'hana quoted post', 'hana parent post', 'hana root post',
  'hana list name', 'hana list description', 'hana thread reply', 'hana focused post',
  'hana reposter text',
]
/** The same for nora. */
export const NORA_SECRETS = [
  'Nora Unread', 'nora.example.com', 'https://cdn.example.com/nora-avatar.jpg', 'nora reposted post',
  'Nora bio text',
]

function detailed(actor: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    ...actor, description: '', banner: '', followersCount: 1, followsCount: 1, postsCount: 3,
    indexedAt: CTS, createdAt: CTS, ...extra,
  }
}

export const profiles: Record<string, Record<string, unknown>> = {
  [alice.did]: detailed(alice, { description: 'Alice bio text', banner: 'https://cdn.example.com/alice-banner.jpg' }),
  [hana.did]: detailed(hana, { description: 'Hana bio text', banner: 'https://cdn.example.com/hana-banner.jpg' }),
  [nora.did]: detailed(nora, { description: 'Nora bio text' }),
  [bob.did]: detailed(bob),
  [pia.did]: detailed(pia, { description: 'Pia bio text' }),
  [quin.did]: detailed(quin, { description: 'Quin bio text' }),
}

let n = 0
function post(author: Record<string, unknown>, text: string, over: Record<string, unknown> = {}) {
  const rkey = (over.rkey as string | undefined) ?? `3kpost${String(++n).padStart(3, '0')}`
  const rest: Record<string, unknown> = { ...over }
  const record = rest.record
  delete rest.rkey
  delete rest.record
  return {
    uri: `at://${String(author.did)}/app.bsky.feed.post/${rkey}`,
    cid: `bafy${rkey}`,
    author,
    record: { $type: 'app.bsky.feed.post', text, createdAt: CTS, ...(record as object | undefined) },
    replyCount: 0, repostCount: 0, likeCount: 0, quoteCount: 0,
    indexedAt: CTS, viewer: {}, labels: [],
    ...rest,
  }
}

const ref = (p: { uri: string; cid: string }) => ({ uri: p.uri, cid: p.cid })

const hanaReposted = post(hana, 'hana reposted post')
const hanaQuoted = post(hana, 'hana quoted post')
const hanaParent = post(hana, 'hana parent post')
const hanaRoot = post(hana, 'hana root post')
const noraReposted = post(nora, 'nora reposted post')
const aliceRepostedByHana = post(alice, 'alice post hana reposted')
const piaPost = post(pia, 'pia null labels post')
const aliceRepostedByQuin = post(alice, 'alice post quin reposted')

export const alicePosts = {
  plain: post(alice, 'alice plain post', { rkey: '3kaliceplain' }),
  quote: post(alice, 'alice quoting hana', {
    embed: {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewRecord', uri: hanaQuoted.uri, cid: hanaQuoted.cid,
        author: hana, value: hanaQuoted.record, labels: [], indexedAt: CTS,
      },
    },
  }),
  reply: post(alice, 'alice replying to hana', {
    record: { reply: { root: ref(hanaRoot), parent: ref(hanaParent) } },
  }),
  list: post(alice, 'alice sharing a list', {
    embed: {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.graph.defs#listView', uri: 'at://did:plc:hana/app.bsky.graph.list/3khanalist',
        cid: 'bafyhanalist', creator: hana, name: 'hana list name', description: 'hana list description',
        purpose: 'app.bsky.graph.defs#curatelist', indexedAt: CTS,
      },
    },
  }),
  // Codex's reproduction: a list whose creator has a DID and nothing else.
  partialList: post(alice, 'alice sharing a partial list', {
    embed: {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.graph.defs#listView', uri: 'at://did:plc:hana/app.bsky.graph.list/3kpartial',
        cid: 'bafypartial', creator: { did: 'did:plc:hana' }, name: 'partial list name', description: 'partial list description',
        purpose: 'app.bsky.graph.defs#curatelist', indexedAt: CTS,
      },
    },
  }),
  // A feed generator with no creator at all.
  creatorlessFeed: post(alice, 'alice sharing a creatorless feed', {
    embed: {
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.feed.defs#generatorView', uri: 'at://did:plc:hana/app.bsky.feed.generator/creatorless',
        cid: 'bafycreatorless', did: 'did:web:feeds.example.com', displayName: 'creatorless feed name',
        description: 'creatorless feed description', avatar: 'https://cdn.example.com/creatorless-avatar.jpg', indexedAt: CTS,
      },
    },
  }),
  // An adult label (graphic media): signed out, a list filters the post.
  graphic: post(alice, 'alice graphic post', {
    rkey: '3kalicegraphic',
    labels: [{ src: BSKY_LABELER, uri: 'at://did:plc:alice/app.bsky.feed.post/3kgraphic', val: 'graphic-media', cts: CTS }],
    embed: {
      $type: 'app.bsky.embed.images#view',
      images: [{ thumb: 'https://cdn.example.com/graphic-thumb.jpg', fullsize: 'https://cdn.example.com/graphic-full.jpg', alt: '' }],
    },
  }),
}

/** alice's author feed: page one (with a cursor) and page two. */
export const aliceFeed = {
  cursor: 'cursor-page-2',
  feed: [
    { post: alicePosts.plain },
    { post: hanaReposted, reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: alice, uri: 'at://did:plc:alice/app.bsky.feed.repost/3krp1', cid: 'bafyrp1', indexedAt: CTS } },
    { post: alicePosts.quote },
    { post: alicePosts.reply, reply: { root: hanaRoot, parent: hanaParent } },
    { post: alicePosts.list },
    { post: noraReposted, reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: alice, uri: 'at://did:plc:alice/app.bsky.feed.repost/3krp2', cid: 'bafyrp2', indexedAt: CTS } },
    // A repost by a hidden reposter (the reposter line).
    { post: aliceRepostedByHana, reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: { ...hana, displayName: 'hana reposter text' }, uri: 'at://did:plc:hana/app.bsky.feed.repost/3krp3', cid: 'bafyrp3', indexedAt: CTS } },
    { post: alicePosts.graphic },
    { post: alicePosts.partialList },
    { post: alicePosts.creatorlessFeed },
    // An author with `labels: null`.
    { post: piaPost },
    // A reposter whose `labels` is not an array.
    { post: aliceRepostedByQuin, reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: quin, uri: 'at://did:plc:quin/app.bsky.feed.repost/3krp4', cid: 'bafyrp4', indexedAt: CTS } },
  ],
}

export const aliceFeedPage2 = {
  feed: [{ post: post(alice, 'alice page two post', { rkey: '3kalicepage2' }) }],
}

const node = (p: unknown, extra: Record<string, unknown> = {}) => ({ $type: 'app.bsky.feed.defs#threadViewPost', post: p, ...extra })

const threadRoot = hanaRoot
const threadParent = post(bob, 'bob parent post', { record: { reply: { root: ref(threadRoot), parent: ref(threadRoot) } } })
export const threadFocus = post(alice, 'alice thread focus', {
  rkey: '3kalicefocus',
  record: { reply: { root: ref(threadRoot), parent: ref(threadParent) } },
})
const hanaReply = post(hana, 'hana thread reply', { record: { reply: { root: ref(threadRoot), parent: ref(threadFocus) } } })
const carolReply = post(carol, 'carol thread reply', { record: { reply: { root: ref(threadRoot), parent: ref(threadFocus) } } })
const piaReply = post(pia, 'pia thread reply', { record: { reply: { root: ref(threadRoot), parent: ref(threadFocus) } } })

/** `/@alice.example.com/3kalicefocus`: hana is the root and has a reply; bob and carol are visible. */
export const aliceThread = {
  thread: node(threadFocus, {
    parent: node(threadParent, { parent: node(threadRoot) }),
    replies: [node(hanaReply), node(carolReply), node(piaReply)],
  }),
}

export const hanaFocus = post(hana, 'hana focused post', { rkey: '3khanafocus' })
/** `/@hana.example.com/3khanafocus`: the focused post's author is hidden; carol replies. */
export const hanaThread = {
  thread: node(hanaFocus, {
    replies: [node(post(carol, 'carol reply to hana', { record: { reply: { root: ref(hanaFocus), parent: ref(hanaFocus) } } }))],
  }),
}

/** A thread whose focused post carries an adult label: covered, no Show. */
export const adultFocus = post(alice, 'alice adult post', {
  rkey: '3kaliceadult',
  labels: [{ src: BSKY_LABELER, uri: 'at://did:plc:alice/app.bsky.feed.post/3kaliceadult', val: 'porn', cts: CTS }],
  embed: {
    $type: 'app.bsky.embed.images#view',
    images: [{ thumb: 'https://cdn.example.com/adult-thumb.jpg', fullsize: 'https://cdn.example.com/adult-full.jpg', alt: '' }],
  },
})
export const adultThread = { thread: node(adultFocus) }

/**
 * A thread whose focused post has a video (#261). The e2e test serves the
 * playlist from `apps/caribou/tests/e2e/fixtures/hls/`.
 */
export const videoFocus = post(alice, 'alice video post', {
  rkey: '3kalicevideo',
  embed: {
    $type: 'app.bsky.embed.video#view',
    cid: 'bafkvideo',
    playlist: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/playlist.m3u8',
    thumbnail: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/thumbnail.jpg',
    alt: 'A caribou running',
    aspectRatio: { width: 16, height: 9 },
  },
})

/** A post with a label value Bluesky's labeler did not define here: covered whatever loads (fail closed). */
export const customLabelFocus = post(alice, 'alice custom label post', {
  rkey: '3kalicecustom',
  labels: [{ src: BSKY_LABELER, uri: 'at://did:plc:alice/app.bsky.feed.post/3kalicecustom', val: 'some-custom-label', cts: CTS }],
})

/**
 * `/@carol.example.com/3kcarolfocus` (#273): a plain thread, every author
 * visible. Bob's root, carol's focused post, bob's reply.
 */
const bobRoot = post(bob, 'bob opens the thread', { rkey: '3kbobroot' })
export const carolFocus = post(carol, 'carol focused post', {
  rkey: '3kcarolfocus',
  record: { reply: { root: ref(bobRoot), parent: ref(bobRoot) } },
})
const bobReply = post(bob, 'bob replies to carol', {
  rkey: '3kbobreply',
  record: { reply: { root: ref(bobRoot), parent: ref(carolFocus) } },
})
export const carolThread = { thread: node(carolFocus, { parent: node(bobRoot), replies: [node(bobReply)] }) }
/** Every post in `carolThread`, for a PDS that answers `getPosts`. */
export const carolThreadPosts = [bobRoot, carolFocus, bobReply]

/** `app.bsky.labeler.getServices` for Bluesky's labeler, detailed. */
export const labelerServices = {
  views: [{
    $type: 'app.bsky.labeler.defs#labelerViewDetailed',
    uri: `at://${BSKY_LABELER}/app.bsky.labeler.service/self`, cid: 'bafylabeler',
    creator: { did: BSKY_LABELER, handle: 'moderation.bsky.app', labels: [] },
    policies: { labelValues: ['porn', 'graphic-media'], labelValueDefinitions: [] },
    likeCount: 0, indexedAt: CTS, labels: [],
  }],
}

/** Handle → DID, for the fixture server and tests. */
export const handles: Record<string, string> = Object.fromEntries(
  [alice, bob, carol, hana, nora, pia, quin].map((a) => [a.handle, a.did]),
)

/** The threads by focused post URI (DID form). */
export const threads: Record<string, unknown> = {
  [threadFocus.uri]: aliceThread,
  [hanaFocus.uri]: hanaThread,
  [adultFocus.uri]: adultThread,
  [customLabelFocus.uri]: { thread: node(customLabelFocus) },
  [videoFocus.uri]: { thread: node(videoFocus) },
  [carolFocus.uri]: carolThread,
}

/** A handle the fixture AppView fails on with a 500. */
export const BROKEN_HANDLE = 'broken.example.com'

/**
 * The fixture AppView: an XRPC method and its query → status and JSON body.
 * The e2e fixture server and unit tests both answer with it.
 */
export function appviewAnswer(method: string, q: URLSearchParams): { status: number; body: unknown } {
  const notFound = (message: string) => ({ status: 400, body: { error: 'NotFound', message } })
  const didOf = (actor: string | null) => (actor ? handles[actor] ?? actor : '')
  const actor = q.get('actor')
  if (actor === BROKEN_HANDLE) return { status: 500, body: { error: 'InternalServerError' } }
  switch (method) {
    case 'app.bsky.actor.getProfile': {
      const view = profiles[didOf(actor)]
      return view ? { status: 200, body: view } : { status: 400, body: { error: 'InvalidRequest', message: 'Profile not found' } }
    }
    case 'app.bsky.feed.getAuthorFeed': {
      if (didOf(actor) !== alice.did) return { status: 200, body: { feed: [] } }
      return { status: 200, body: q.get('cursor') === aliceFeed.cursor ? aliceFeedPage2 : aliceFeed }
    }
    case 'app.bsky.feed.getPostThread': {
      const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/.exec(q.get('uri') ?? '')
      if (!m) return { status: 400, body: { error: 'InvalidRequest' } }
      if (m[1] === BROKEN_HANDLE) return { status: 500, body: { error: 'InternalServerError' } }
      const thread = threads[`at://${didOf(m[1]!)}/app.bsky.feed.post/${m[2]!}`]
      return thread ? { status: 200, body: thread } : notFound('Post not found')
    }
    case 'app.bsky.labeler.getServices':
      return { status: 200, body: labelerServices }
    default:
      return { status: 404, body: { error: 'MethodNotImplemented' } }
  }
}
