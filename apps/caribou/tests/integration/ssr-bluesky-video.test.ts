// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import { ssr } from './_ssr.js'
import '../../components/caribou-bluesky-video.js'

// README, "Bluesky video", rule 2: the server renders the thumbnail link,
// the first client render's markup, and never a <video>.
const CARD = {
  type: 'video', url: 'https://bsky.app/profile/did:plc:alice/post/3kpost', title: 'A caribou running',
  description: 'Play on bsky.app', image: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/thumbnail.jpg',
  width: 16, height: 9, providerName: 'bsky.app', authors: [],
  embedUrl: 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/playlist.m3u8',
}

describe('caribou-bluesky-video SSR', () => {
  it('rule 2: renders the thumbnail as a link to bsky.app, and no <video>', async () => {
    const out = await ssr(html`<caribou-bluesky-video .card=${CARD}></caribou-bluesky-video>`)
    expect(out).toMatch(/<a class="poster" href="https:\/\/bsky\.app\/profile\/did:plc:alice\/post\/3kpost"/)
    expect(out).toContain('aria-label="Play video: A caribou running"')
    expect(out).toContain(`--ar: ${16 / 9}`)
    expect(out).not.toContain('<video')
    expect(out).not.toContain('playlist.m3u8')
  })
})
