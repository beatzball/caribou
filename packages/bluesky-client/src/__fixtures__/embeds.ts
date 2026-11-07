// Embed views in the shape the AppView returns them (`app.bsky.feed.getPostThread`,
// `getTimeline`), with placeholder accounts only.

const alice = {
  did: 'did:plc:alice',
  handle: 'alice.example.com',
  displayName: 'Alice',
  avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/bafkavatar@jpeg',
  labels: [],
  createdAt: '2024-01-01T00:00:00.000Z',
}

// The quoted post's author carries labels and viewer state, so a test can
// check that moderation still sees them after the handoff to `mapPost`.
const bob = {
  did: 'did:plc:bob',
  handle: 'bob.example.com',
  displayName: 'Bob',
  labels: [
    { src: 'did:plc:labeler', uri: 'did:plc:bob', val: 'rude', cts: '2026-10-01T00:00:00.000Z' },
  ],
  viewer: { muted: true, blockedBy: false },
}

export const POST_URI = 'at://did:plc:alice/app.bsky.feed.post/3kpost'
export const POST_URL = 'https://bsky.app/profile/did:plc:alice/post/3kpost'

export const imagesView = {
  $type: 'app.bsky.embed.images#view',
  images: [
    {
      thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkimg1@jpeg',
      fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/bafkimg1@jpeg',
      alt: 'A caribou in the snow',
      aspectRatio: { width: 2000, height: 1500 },
    },
    {
      thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkimg2@jpeg',
      fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/bafkimg2@jpeg',
      alt: '',
    },
  ],
}

export const externalView = {
  $type: 'app.bsky.embed.external#view',
  external: {
    uri: 'https://example.com/article',
    title: 'An article',
    description: 'What the article is about.',
    thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkthumb@jpeg',
  },
}

export const tenorGifView = {
  $type: 'app.bsky.embed.external#view',
  external: {
    uri: 'https://media.tenor.com/abc/tenor.gif?hh=200&ww=300',
    title: 'Dancing GIF',
    description: 'Alt: a dancing caribou',
    thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkgif@jpeg',
  },
}

export const videoView = {
  $type: 'app.bsky.embed.video#view',
  cid: 'bafkvideo',
  playlist: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/playlist.m3u8',
  thumbnail: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/thumbnail.jpg',
  alt: 'A caribou running',
  aspectRatio: { width: 1080, height: 1920 },
}

// The raw record keeps its self-labels and its image alt text: moderation
// reads both (self-labels, and muted words in alt text).
export const galleryView = {
  $type: 'app.bsky.embed.gallery#view',
  items: [
    {
      $type: 'app.bsky.embed.gallery#viewImage',
      thumbnail: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkgal1@jpeg',
      fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:alice/bafkgal1@jpeg',
      alt: 'First',
      aspectRatio: { width: 1000, height: 1000 },
    },
    { $type: 'app.bsky.embed.gallery#viewSomethingNew', data: 1 },
  ],
}

export const quotedPostValue = {
  $type: 'app.bsky.feed.post',
  text: 'The quoted post',
  createdAt: '2026-11-01T10:00:00.000Z',
  langs: ['en'],
  labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'graphic-media' }] },
  embed: {
    $type: 'app.bsky.embed.images',
    images: [{ alt: 'A caribou in the snow', image: { $type: 'blob', ref: { $link: 'bafkimg1' }, mimeType: 'image/jpeg', size: 1000 } }],
  },
}

export const viewRecord = {
  $type: 'app.bsky.embed.record#viewRecord',
  uri: 'at://did:plc:bob/app.bsky.feed.post/3kquoted',
  cid: 'bafkquoted',
  author: bob,
  value: quotedPostValue,
  labels: [
    { src: 'did:plc:labeler', uri: 'at://did:plc:bob/app.bsky.feed.post/3kquoted', val: 'spam', cts: '2026-11-01T11:00:00.000Z' },
    { src: 'did:plc:bob', uri: 'at://did:plc:bob/app.bsky.feed.post/3kquoted', val: 'graphic-media', cts: '2026-11-01T10:00:00.000Z' },
  ],
  likeCount: 3,
  replyCount: 1,
  repostCount: 2,
  quoteCount: 0,
  indexedAt: '2026-11-01T10:00:01.000Z',
  embeds: [imagesView],
}

export const recordView = { $type: 'app.bsky.embed.record#view', record: viewRecord }

export const notFoundView = {
  $type: 'app.bsky.embed.record#view',
  record: { $type: 'app.bsky.embed.record#viewNotFound', uri: 'at://did:plc:bob/app.bsky.feed.post/3kgone', notFound: true },
}

export const blockedView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.embed.record#viewBlocked',
    uri: 'at://did:plc:bob/app.bsky.feed.post/3kblocked',
    blocked: true,
    author: { did: 'did:plc:bob', viewer: { blocking: 'at://did:plc:alice/app.bsky.graph.block/3kblock' } },
  },
}

// A block the reader made, a block against the reader, and a block between
// the two authors (every reader sees it, with no viewer state).
export const blockedByView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.embed.record#viewBlocked',
    uri: 'at://did:plc:bob/app.bsky.feed.post/3kblocked',
    blocked: true,
    author: { did: 'did:plc:bob', viewer: { blockedBy: true } },
  },
}

export const blockedBetweenAuthorsView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.embed.record#viewBlocked',
    uri: 'at://did:plc:bob/app.bsky.feed.post/3kblocked',
    blocked: true,
    author: { did: 'did:plc:bob' },
  },
}

export const detachedView = {
  $type: 'app.bsky.embed.record#view',
  record: { $type: 'app.bsky.embed.record#viewDetached', uri: 'at://did:plc:bob/app.bsky.feed.post/3kdetached', detached: true },
}

export const feedGeneratorView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.feed.defs#generatorView',
    uri: 'at://did:plc:alice/app.bsky.feed.generator/caribous',
    cid: 'bafkfeed',
    did: 'did:web:feeds.example.com',
    creator: alice,
    displayName: 'Caribou pictures',
    description: 'Only caribou.',
    avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/bafkfeedavatar@jpeg',
    likeCount: 10,
    indexedAt: '2026-10-01T00:00:00.000Z',
  },
}

export const listView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.graph.defs#listView',
    uri: 'at://did:plc:alice/app.bsky.graph.list/3klist',
    cid: 'bafklist',
    creator: alice,
    name: 'Herd',
    purpose: 'app.bsky.graph.defs#curatelist',
    description: 'People who post caribou.',
    indexedAt: '2026-10-01T00:00:00.000Z',
  },
}

export const starterPackView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.graph.defs#starterPackViewBasic',
    uri: 'at://did:plc:alice/app.bsky.graph.starterpack/3kpack',
    cid: 'bafkpack',
    record: { $type: 'app.bsky.graph.starterpack', name: 'Caribou fans', list: 'at://did:plc:alice/app.bsky.graph.list/3klist', createdAt: '2026-10-01T00:00:00.000Z' },
    creator: alice,
    joinedAllTimeCount: 4,
    indexedAt: '2026-10-01T00:00:00.000Z',
  },
}

export const labelerView = {
  $type: 'app.bsky.embed.record#view',
  record: {
    $type: 'app.bsky.labeler.defs#labelerView',
    uri: 'at://did:plc:alice/app.bsky.labeler.service/self',
    cid: 'bafklabeler',
    creator: alice,
    likeCount: 1,
    indexedAt: '2026-10-01T00:00:00.000Z',
  },
}

export const recordWithImagesView = {
  $type: 'app.bsky.embed.recordWithMedia#view',
  record: recordView,
  media: imagesView,
}

export const recordWithExternalView = {
  $type: 'app.bsky.embed.recordWithMedia#view',
  record: notFoundView,
  media: externalView,
}

export const recordWithVideoView = {
  $type: 'app.bsky.embed.recordWithMedia#view',
  record: recordView,
  media: videoView,
}

export const feedWithImagesView = {
  $type: 'app.bsky.embed.recordWithMedia#view',
  record: feedGeneratorView,
  media: imagesView,
}

export const feedWithExternalView = {
  $type: 'app.bsky.embed.recordWithMedia#view',
  record: feedGeneratorView,
  media: externalView,
}

export const feedWithVideoView = {
  $type: 'app.bsky.embed.recordWithMedia#view',
  record: feedGeneratorView,
  media: videoView,
}
