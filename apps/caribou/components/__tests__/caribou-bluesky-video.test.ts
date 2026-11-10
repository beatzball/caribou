import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewCard } from '@beatzball/caribou-mastodon-client'

// The rules are in the README, "Bluesky video". Each test names its rule.

const hls = vi.hoisted(() => {
  const instances: FakeHls[] = []
  class FakeHls {
    static isSupported = vi.fn(() => true)
    static Events = { ERROR: 'hlsError' }
    handlers = new Map<string, (event: string, data: { fatal: boolean }) => void>()
    loadSource = vi.fn()
    attachMedia = vi.fn()
    destroy = vi.fn()
    constructor() { instances.push(this) }
    on(event: string, fn: (event: string, data: { fatal: boolean }) => void) { this.handlers.set(event, fn) }
    fail(fatal: boolean) { this.handlers.get('hlsError')?.('hlsError', { fatal }) }
  }
  return { FakeHls, instances, load: vi.fn(async () => ({ default: FakeHls }) as never) }
})
vi.mock('../_hls-loader.js', () => ({ loadHls: hls.load }))

import '../caribou-bluesky-video.js'
import type { CaribouBlueskyVideo } from '../caribou-bluesky-video.js'

const PLAYLIST = 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/playlist.m3u8'
const THUMB = 'https://video.bsky.app/watch/did%3Aplc%3Aalice/bafkvideo/thumbnail.jpg'
const POST = 'https://bsky.app/profile/did:plc:alice/post/3kpost'

function videoCard(over: Partial<PreviewCard> = {}): PreviewCard {
  return {
    type: 'video', url: POST, title: 'A caribou running', description: 'Play on bsky.app',
    image: THUMB, width: 1080, height: 1920, providerName: 'bsky.app', authors: [], embedUrl: PLAYLIST,
    ...over,
  } as PreviewCard
}

async function mount(card: PreviewCard): Promise<CaribouBlueskyVideo> {
  const el = document.createElement('caribou-bluesky-video')
  el.card = card
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const $ = <T extends Element = HTMLElement>(el: Element, sel: string) => el.shadowRoot!.querySelector<T>(sel)

// Native HLS is Safari's; happy-dom answers '' for every type.
function nativeHls(yes: boolean) {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(
    (type: string) => yes && type === 'application/vnd.apple.mpegurl' ? 'maybe' : '')
}

async function press(el: CaribouBlueskyVideo) {
  $(el, 'a.poster')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }))
  await vi.waitFor(async () => {
    await el.updateComplete
    expect($(el, 'video')).not.toBeNull()
  })
  // Let the source attach (a microtask for the import, one for the update).
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  await el.updateComplete
}

describe('<caribou-bluesky-video>', () => {
  let play: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    document.body.replaceChildren()
    hls.instances.length = 0
    hls.load.mockClear()
    hls.load.mockImplementation(async () => ({ default: hls.FakeHls }) as never)
    hls.FakeHls.isSupported.mockReturnValue(true)
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    nativeHls(false)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('rule 1: shows the thumbnail and loads nothing before the press', async () => {
    const el = await mount(videoCard())
    expect($<HTMLImageElement>(el, 'a.poster img')!.getAttribute('src')).toBe(THUMB)
    expect($(el, 'video')).toBeNull()
    expect(hls.load).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })

  it('rule 2: the thumbnail is a link to the post on bsky.app', async () => {
    const el = await mount(videoCard())
    const a = $<HTMLAnchorElement>(el, 'a.poster')!
    expect(a.getAttribute('href')).toBe(POST)
    expect(a.getAttribute('target')).toBe('_blank')
  })

  it('rule 2: a modifier click follows the link and does not play', async () => {
    const el = await mount(videoCard())
    const click = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0, metaKey: true })
    $(el, 'a.poster')!.dispatchEvent(click)
    await el.updateComplete
    expect(click.defaultPrevented).toBe(false)
    expect($(el, 'video')).toBeNull()
  })

  it('rule 3: Safari plays the playlist natively, with no hls.js', async () => {
    nativeHls(true)
    const el = await mount(videoCard())
    await press(el)
    const v = $<HTMLVideoElement>(el, 'video')!
    expect(v.getAttribute('src')).toBe(PLAYLIST)
    expect(v.hasAttribute('controls')).toBe(true)
    expect(v.getAttribute('poster')).toBe(THUMB)
    expect(hls.load).not.toHaveBeenCalled()
    expect(play).toHaveBeenCalled()
  })

  it('rule 4: another browser loads hls.js on the press and attaches it', async () => {
    const el = await mount(videoCard())
    await press(el)
    expect(hls.load).toHaveBeenCalledTimes(1)
    const [h] = hls.instances
    expect(h!.loadSource).toHaveBeenCalledWith(PLAYLIST)
    expect(h!.attachMedia).toHaveBeenCalledWith($(el, 'video'))
    expect($(el, 'video')!.hasAttribute('src')).toBe(false)
    expect(play).toHaveBeenCalled()
  })

  it('rule 4: a browser with neither shows the error', async () => {
    hls.FakeHls.isSupported.mockReturnValue(false)
    const el = await mount(videoCard())
    await press(el)
    expect(hls.instances).toHaveLength(0)
    expect($(el, '[role="alert"]')?.textContent).toContain('This video could not play.')
  })

  it('rule 5: the box takes the embed aspect ratio, and 16:9 without one', async () => {
    const el = await mount(videoCard())
    expect($(el, '.box')!.getAttribute('style')).toContain(`--ar: ${1080 / 1920}`)
    await press(el)
    expect($(el, '.box')!.getAttribute('style')).toContain(`--ar: ${1080 / 1920}`)
    const plain = await mount(videoCard({ width: 0, height: 0 }))
    expect($(plain, '.box')!.getAttribute('style')).toContain(`--ar: ${16 / 9}`)
  })

  it('rule 6: a fatal hls.js error shows the error with a link to bsky.app; a non-fatal one does not', async () => {
    const el = await mount(videoCard())
    await press(el)
    hls.instances[0]!.fail(false)
    await el.updateComplete
    expect($(el, '[role="alert"]')).toBeNull()
    hls.instances[0]!.fail(true)
    await el.updateComplete
    const alert = $(el, '[role="alert"]')!
    expect(alert.textContent).toContain('This video could not play.')
    const link = alert.querySelector('a')!
    expect(link.textContent).toBe('Watch on bsky.app')
    expect(link.getAttribute('href')).toBe(POST)
    expect($<HTMLImageElement>(el, '.box img')!.getAttribute('src')).toBe(THUMB)
    expect(hls.instances[0]!.destroy).toHaveBeenCalled()
  })

  it('rule 6: a <video> error shows the error', async () => {
    nativeHls(true)
    const el = await mount(videoCard())
    await press(el)
    $(el, 'video')!.dispatchEvent(new Event('error'))
    await el.updateComplete
    expect($(el, '[role="alert"]')?.textContent).toContain('This video could not play.')
  })

  it('rule 6: a failed load of hls.js shows the error', async () => {
    hls.load.mockImplementationOnce(async () => { throw new Error('chunk failed') })
    const el = await mount(videoCard())
    await press(el)
    expect($(el, '[role="alert"]')?.textContent).toContain('This video could not play.')
  })

  it('rule 7: the alt text names the control and the video, and the ALT badge shows it', async () => {
    nativeHls(true)
    const el = await mount(videoCard())
    expect($(el, 'a.poster')!.getAttribute('aria-label')).toBe('Play video: A caribou running')
    expect($(el, '.alt-text')!.textContent).toBe('A caribou running')
    await press(el)
    expect($(el, 'video')!.getAttribute('aria-label')).toBe('A caribou running')
  })

  it('rule 7: with no alt text the name is "Play video", and no badge', async () => {
    const el = await mount(videoCard({ title: 'Video' }))
    expect($(el, 'a.poster')!.getAttribute('aria-label')).toBe('Play video')
    expect($(el, '.alt')).toBeNull()
  })

  it('rule 8: leaving the DOM destroys hls.js and removes the source; back in, the thumbnail', async () => {
    const el = await mount(videoCard())
    await press(el)
    const h = hls.instances[0]!
    el.remove()
    expect(h.destroy).toHaveBeenCalledTimes(1)
    document.body.appendChild(el)
    await el.updateComplete
    expect($(el, 'video')).toBeNull()
    expect($(el, 'a.poster')).not.toBeNull()
  })

  it('rule 8: leaving the DOM while hls.js still loads never attaches it', async () => {
    let release!: () => void
    hls.load.mockImplementationOnce(() => new Promise((r) => { release = () => r({ default: hls.FakeHls } as never) }))
    const el = await mount(videoCard())
    $(el, 'a.poster')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }))
    await vi.waitFor(() => expect(hls.load).toHaveBeenCalled())
    el.remove()
    release()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    expect(hls.instances).toHaveLength(0)
  })

  it('rule 8: a new card stops the old stream', async () => {
    const el = await mount(videoCard())
    await press(el)
    const h = hls.instances[0]!
    el.card = videoCard({ embedUrl: PLAYLIST.replace('bafkvideo', 'bafkother') })
    await el.updateComplete
    expect(h.destroy).toHaveBeenCalled()
    expect($(el, 'video')).toBeNull()
  })

  it('renders nothing without an http(s) playlist or link', async () => {
    expect((await mount(videoCard({ embedUrl: 'javascript:x' }))).shadowRoot!.querySelector('.box')).toBeNull()
    expect((await mount(videoCard({ url: 'javascript:x' }))).shadowRoot!.querySelector('.box')).toBeNull()
  })
})
