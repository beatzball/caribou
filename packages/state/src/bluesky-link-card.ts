// Bluesky link cards in a draft (#200, spec 7.2). Rules K1 to K6: README,
// "Bluesky link cards". The fetch itself is in the client package.
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import type { ComposeDraft } from './compose.js'
import { activeUserKey } from './users.js'

/** K2: a card goes with no other embed (no images, no quote). */
export function cardAllowed(d: ComposeDraft): boolean {
  const b = d.bluesky
  return !!b && b.images.length === 0 && !b.quote
}

export interface PrepareCardThumbOptions {
  /** The card's image as a file ready to upload (fetched, fitted to 1 MB). Throws on failure. */
  loadImage: (url: string) => Promise<Blob>
}

/**
 * K4: uploads the card's image before Post, once. Returns the draft to send:
 * the same object when there is nothing to do, a new one with `thumb` (or,
 * after any failure, with `image: null`), or null when the account changed
 * during the await (nothing to apply).
 */
export async function prepareCardThumb(
  client: CaribouClient, d: ComposeDraft, opts: PrepareCardThumbOptions,
): Promise<ComposeDraft | null> {
  const b = d.bluesky
  const card = b?.card
  if (!b || !card || b.sent || !card.image || card.thumb || !cardAllowed(d)) return d
  const upload = client.blueskyUploadBlob?.bind(client)
  const stillActive = () => activeUserKey.peek() === client.userKey
  let thumb = null
  try {
    if (!upload) throw new Error('Not a Bluesky client')
    const file = await opts.loadImage(card.image)
    if (!stillActive()) return null
    thumb = await upload(file)
  } catch {
    // The card is posted without its image, and a retry is the same post.
  }
  if (!stillActive()) return null
  return { ...d, bluesky: { ...b, card: thumb ? { ...card, thumb } : { ...card, image: null, thumb: null } } }
}
