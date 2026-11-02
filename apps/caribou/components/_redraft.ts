import type { mastodon } from 'masto'
import { emptyDraft, type ComposeDraft, type DraftMedia } from '@beatzball/caribou-state'
import { plainText } from './_compose-text.js'

type Status = mastodon.v1.Status

/**
 * Why Edit is refused on a post with a poll. Mastodon removes the poll from
 * an edit that leaves it out, and starts it again (votes gone) from one
 * that sends it.
 */
export const POLL_EDIT_REFUSED = 'Caribou cannot edit a post with a poll yet: Mastodon would remove the poll and its votes.'

/** An attachment of a post, as a draft holds it. */
export function draftMediaOf(m: mastodon.v1.MediaAttachment): DraftMedia {
  return {
    id: m.id, type: m.type, url: m.url ?? '', previewUrl: m.previewUrl ?? null,
    description: m.description ?? '',
  }
}

/**
 * The draft a delete-and-redraft opens: what the deleted post had. `gone` is
 * the server's answer to the delete, whose `text` is the source as typed;
 * `before` is the post as the reader saw it, for an older server that sends
 * no `text`. Mastodon keeps the media of a deleted post for a while, so the
 * new post can attach it again.
 */
export function redraftOf(gone: Status, before: Status): ComposeDraft {
  const spoilerText = gone.spoilerText ?? before.spoilerText ?? ''
  return emptyDraft({
    text: gone.text ?? plainText(before.content ?? ''),
    spoilerText,
    cw: spoilerText !== '',
    visibility: gone.visibility ?? before.visibility,
    inReplyToId: gone.inReplyToId ?? before.inReplyToId ?? null,
    media: (gone.mediaAttachments ?? before.mediaAttachments ?? []).map(draftMediaOf),
    sensitive: gone.sensitive ?? before.sensitive ?? false,
    language: gone.language ?? before.language ?? null,
  })
}
