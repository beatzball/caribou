import { describe, expect, it, vi } from 'vitest'
import {
  CARD_DESCRIPTION_MAX, CARD_TITLE_MAX, CARDYB_EXTRACT, fetchCardImage, fetchLinkCard,
} from '../link-card.js'

const LINK = 'https://example.com/post'
const IMAGE = 'https://cardyb.bsky.app/v1/image?url=https%3A%2F%2Fexample.com%2Fog.png'

// A cardyb answer, the shape `/v1/extract` gives (checked by hand 2026-11-10).
function extract(over: Record<string, unknown> = {}) {
  return {
    error: '', likely_type: 'html', url: LINK, title: 'A title', description: 'A description',
    image: IMAGE, icon: 'https://cardyb.bsky.app/v1/favicon?url=x', ...over,
  }
}

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }))
}

describe('fetchLinkCard', () => {
  it('C3: asks cardyb for the link and keeps the link the reader typed', async () => {
    const f = jsonFetch(extract({ url: 'https://example.com/after-redirect' }))
    const card = await fetchLinkCard(LINK, { fetch: f })
    expect(card).toEqual({ uri: LINK, title: 'A title', description: 'A description', image: IMAGE })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${CARDYB_EXTRACT}?url=${encodeURIComponent(LINK)}`)
    // C4: no cookies, no referrer.
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
  })

  it('C1: no title is no card', async () => {
    expect(await fetchLinkCard(LINK, { fetch: jsonFetch(extract({ title: '  ' })) })).toBeNull()
  })

  it('C1: an error is no card', async () => {
    expect(await fetchLinkCard(LINK, { fetch: jsonFetch(extract({ error: 'failed to fetch' })) })).toBeNull()
  })

  it('C1: a 500 is no card', async () => {
    expect(await fetchLinkCard(LINK, { fetch: jsonFetch(extract(), 500) })).toBeNull()
  })

  it('C1: a body that is not JSON is no card', async () => {
    expect(await fetchLinkCard(LINK, { fetch: jsonFetch('<html>') })).toBeNull()
  })

  it('C1: a network error is no card', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await fetchLinkCard(LINK, { fetch: f })).toBeNull()
  })

  it('C3: a timeout is no card', async () => {
    vi.useFakeTimers()
    try {
      const f = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const out = fetchLinkCard(LINK, { fetch: f })
      await vi.advanceTimersByTimeAsync(5000)
      expect(await out).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('C3: the caller can abort', async () => {
    const ctl = new AbortController()
    const f = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const out = fetchLinkCard(LINK, { fetch: f, signal: ctl.signal })
    ctl.abort()
    expect(await out).toBeNull()
  })

  it('C3: a body over 64 KB is no card', async () => {
    const f = jsonFetch(extract({ description: 'x'.repeat(70_000) }))
    expect(await fetchLinkCard(LINK, { fetch: f })).toBeNull()
  })

  it('C3: cuts the title and the description, trimmed', async () => {
    const f = jsonFetch(extract({ title: `  ${'t'.repeat(400)}`, description: `${'d'.repeat(1200)}  ` }))
    const card = await fetchLinkCard(LINK, { fetch: f })
    expect(card?.title).toHaveLength(CARD_TITLE_MAX)
    expect(card?.description).toHaveLength(CARD_DESCRIPTION_MAX)
    expect(card?.title.startsWith('t')).toBe(true)
  })

  it('C1: a missing description is an empty string', async () => {
    const card = await fetchLinkCard(LINK, { fetch: jsonFetch(extract({ description: undefined })) })
    expect(card?.description).toBe('')
  })

  it('C4: an image on another host is dropped, the card stays', async () => {
    const card = await fetchLinkCard(LINK, { fetch: jsonFetch(extract({ image: 'https://evil.example/x.png' })) })
    expect(card).toMatchObject({ title: 'A title', image: null })
  })

  it('C2: a link that is not http or https is never sent', async () => {
    const f = jsonFetch(extract())
    expect(await fetchLinkCard('ftp://example.com/x', { fetch: f })).toBeNull()
    expect(await fetchLinkCard('javascript:alert(1)', { fetch: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('fetchCardImage', () => {
  function imageFetch(type: string, bytes = 10) {
    return vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } }))
  }

  it('C4: fetches a cardyb image as a blob, with no cookies', async () => {
    const f = imageFetch('image/jpeg')
    const blob = await fetchCardImage(IMAGE, { fetch: f })
    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBe(10)
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.credentials).toBe('omit')
  })

  it('C4: refuses an image URL that is not cardyb', async () => {
    const f = imageFetch('image/jpeg')
    await expect(fetchCardImage('https://evil.example/x.png', { fetch: f })).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })

  it('C4: refuses an answer that is not an image', async () => {
    await expect(fetchCardImage(IMAGE, { fetch: imageFetch('text/html') })).rejects.toThrow()
  })

  it('C3: refuses an image over 5 MB', async () => {
    await expect(fetchCardImage(IMAGE, { fetch: imageFetch('image/png', 5_000_001) })).rejects.toThrow()
  })

  it('C1: a 404 throws', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 404 }))
    await expect(fetchCardImage(IMAGE, { fetch: f })).rejects.toThrow()
  })
})

// C3: the cap stops the transfer, not only the result.
describe('the size cap reads a stream, and cancels it', () => {
  // A body of `chunks` chunks of 64 KB, with no Content-Length.
  function streamed(chunks: number, type: string) {
    const seen = { pulled: 0, cancelled: false }
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (seen.pulled >= chunks) return ctl.close()
        seen.pulled += 1
        ctl.enqueue(new Uint8Array(65_536))
      },
      cancel() { seen.cancelled = true },
    }, { highWaterMark: 0 })
    return { seen, fetch: vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': type } })) }
  }

  it('an image stream over 5 MB is cancelled long before its end', async () => {
    const s = streamed(320, 'image/png') // 20 MB
    await expect(fetchCardImage(IMAGE, { fetch: s.fetch })).rejects.toThrow('Too large')
    expect(s.seen.cancelled).toBe(true)
    expect(s.seen.pulled).toBeLessThan(100)
  })

  it('a card stream over 64 KB is cancelled after its second chunk', async () => {
    const s = streamed(100, 'application/json')
    expect(await fetchLinkCard(LINK, { fetch: s.fetch })).toBeNull()
    expect(s.seen.cancelled).toBe(true)
    expect(s.seen.pulled).toBeLessThanOrEqual(3)
  })

  it('a body refused by its Content-Length is cancelled unread', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel() { cancelled = true } })
    const f = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '9000000' } }))
    await expect(fetchCardImage(IMAGE, { fetch: f })).rejects.toThrow('Too large')
    expect(cancelled).toBe(true)
  })
})
