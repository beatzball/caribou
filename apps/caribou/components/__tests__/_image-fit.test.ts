import { describe, expect, it, vi } from 'vitest'
import { fitImage, type ImageCodec } from '../_image-fit.js'

const MAX = 2_000_000

/**
 * A codec whose output size follows pixels × quality, like a real JPEG
 * encoder roughly does. `bytesPerPixel` sets how hard the image is to shrink.
 */
function codec(width: number, height: number, bytesPerPixel = 1, opts: { fail?: boolean } = {}) {
  // Only the size and type are read, so no real bytes are made.
  const encode = vi.fn(async (w: number, h: number, quality: number) =>
    ({ size: Math.round(w * h * bytesPerPixel * quality), type: 'image/jpeg' }) as Blob)
  const c: ImageCodec = {
    decode: vi.fn(async () => {
      if (opts.fail) throw new Error('cannot decode')
      return { width, height, encode, close: vi.fn() }
    }),
  }
  return { codec: c, encode }
}

function file(size: number, type = 'image/jpeg') {
  return { size, type, name: 'photo.jpg' } as File
}

describe('fitImage', () => {
  it('keeps an image at or under the limit as it is, with its size', async () => {
    const { codec: c, encode } = codec(800, 600)
    const f = file(MAX)
    const out = await fitImage(f, MAX, c)
    expect(out).toEqual({ ok: true, blob: f, width: 800, height: 600, resized: false })
    expect(encode).not.toHaveBeenCalled()
  })

  it('re-encodes an image over the limit until it is under, as JPEG', async () => {
    const { codec: c } = codec(4000, 3000, 0.4)
    const out = await fitImage(file(5_000_000), MAX, c)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.resized).toBe(true)
    expect(out.blob.size).toBeLessThanOrEqual(MAX)
    expect(out.blob.type).toBe('image/jpeg')
    // The long side starts at 2000 and the aspect ratio is kept.
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2000)
    expect(out.width / out.height).toBeCloseTo(4 / 3, 1)
  })

  it('shrinks the size when quality alone is not enough', async () => {
    const { codec: c, encode } = codec(2000, 2000, 1)
    const out = await fitImage(file(3_000_000), MAX, c)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.blob.size).toBeLessThanOrEqual(MAX)
    expect(out.width).toBeLessThan(2000)
    expect(encode.mock.calls.length).toBeGreaterThan(3)
  })

  it('refuses an image that cannot get under the limit', async () => {
    const { codec: c } = codec(2000, 2000, 100)
    await expect(fitImage(file(50_000_000), MAX, c)).resolves.toEqual({ ok: false, reason: 'too-large' })
  })

  it('refuses an image over the limit that cannot be read', async () => {
    const { codec: c } = codec(1, 1, 1, { fail: true })
    await expect(fitImage(file(3_000_000), MAX, c)).resolves.toEqual({ ok: false, reason: 'unreadable' })
  })

  it('keeps an unreadable image under the limit, with no size', async () => {
    const { codec: c } = codec(1, 1, 1, { fail: true })
    const f = file(1000)
    await expect(fitImage(f, MAX, c)).resolves.toEqual({ ok: true, blob: f, width: 0, height: 0, resized: false })
  })

  it('refuses a file that is not an image', async () => {
    const { codec: c } = codec(10, 10)
    await expect(fitImage(file(10, 'video/mp4'), MAX, c)).resolves.toEqual({ ok: false, reason: 'not-image' })
  })
})
