// Makes an image small enough for Bluesky, in the browser (spec 7.2). Rules
// in the app README, "Bluesky compose".

/** A decoded image that can be encoded again at another size. */
export interface DecodedImage {
  width: number
  height: number
  /** A JPEG of the image drawn at `w` × `h`. */
  encode(w: number, h: number, quality: number): Promise<Blob>
  close?(): void
}

export interface ImageCodec {
  decode(file: Blob): Promise<DecodedImage>
}

export type FitResult =
  | { ok: true; blob: Blob; width: number; height: number; resized: boolean }
  | { ok: false; reason: 'not-image' | 'unreadable' | 'too-large' }

/** The long side the first re-encode tries. Bluesky shows no more. */
const START_SIDE = 2000
/** Below this long side the image is refused rather than made smaller. */
const MIN_SIDE = 400
const QUALITIES = [0.9, 0.8, 0.7]
const SHRINK = 0.8

/**
 * The image as it can be uploaded: always a new JPEG drawn on a canvas, so
 * no EXIF data (GPS position included) reaches the PDS, where a blob is
 * public, and the type is one Bluesky shows. Step by step (quality first,
 * then size) until it is at most `maxBytes`. Refused when it is not an
 * image, cannot be read (it then cannot be cleaned either), or is still too
 * large at the smallest size. An animated GIF keeps its first frame only.
 */
export async function fitImage(file: Blob, maxBytes: number, codec: ImageCodec = canvasCodec): Promise<FitResult> {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'not-image' }
  let img: DecodedImage
  try {
    img = await codec.decode(file)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  try {
    const long = Math.max(img.width, img.height)
    for (let side = Math.min(long, START_SIDE); side >= Math.min(MIN_SIDE, long); side = Math.floor(side * SHRINK)) {
      const scale = side / long
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      for (const quality of QUALITIES) {
        const blob = await img.encode(w, h, quality)
        if (blob.size <= maxBytes) return { ok: true, blob, width: w, height: h, resized: w !== img.width || h !== img.height }
      }
      // A small image has no smaller size to try.
      if (side <= MIN_SIDE) break
    }
    return { ok: false, reason: 'too-large' }
  } finally {
    img.close?.()
  }
}

/** The browser's own decoder and a canvas. */
export const canvasCodec: ImageCodec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bitmap.width,
      height: bitmap.height,
      async encode(w, h, quality) {
        const canvas = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h })
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
        if (!ctx) throw new Error('No canvas')
        // JPEG has no transparency: a see-through PNG gets a white ground.
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(bitmap, 0, 0, w, h)
        if (canvas instanceof HTMLCanvasElement) {
          return new Promise<Blob>((resolve, reject) => canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error('Could not encode')), 'image/jpeg', quality,
          ))
        }
        return canvas.convertToBlob({ type: 'image/jpeg', quality })
      },
      close: () => bitmap.close(),
    }
  },
}
