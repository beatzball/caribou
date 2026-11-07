import type { AppBskyRichtextFacet } from '@atproto/api'

// The `record` of an AppView `app.bsky.feed.defs#postView`, as
// `app.bsky.feed.getPostThread` returns it. Placeholder accounts only.
// Byte offsets are UTF-8: "👋 " is 5 bytes, "é" is 2.
export const postRecord: { $type: string; text: string; facets: AppBskyRichtextFacet.Main[]; createdAt: string; langs: string[] } = {
  $type: 'app.bsky.feed.post',
  text: '👋 hi @alice.example.com, café notes at example.com/notes… #caribou',
  facets: [
    {
      $type: 'app.bsky.richtext.facet',
      index: { byteStart: 8, byteEnd: 26 },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' }],
    },
    {
      $type: 'app.bsky.richtext.facet',
      index: { byteStart: 43, byteEnd: 63 },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/notes/2026/caribou' }],
    },
    {
      $type: 'app.bsky.richtext.facet',
      index: { byteStart: 64, byteEnd: 72 },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'caribou' }],
    },
  ],
  createdAt: '2026-11-06T00:00:00.000Z',
  langs: ['en'],
}
