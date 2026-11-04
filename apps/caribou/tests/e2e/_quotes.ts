// Posts for quotes.spec.ts and quotes.mobile.spec.ts: a home timeline whose
// posts quote others (Mastodon 4.5 `quote`), in every state.
import { BOB, CAROL, status } from './_moderation.js'

export const quoted = (id: string, over: Record<string, unknown> = {}) =>
  ({ ...status(id, BOB), content: `<p>quoted words ${id}</p>`, ...over })

export const quoting = (id: string, quote: unknown) => ({ ...status(id, CAROL), quote })

export const accepted = (id: string, q: unknown) => quoting(id, { state: 'accepted', quoted_status: q })

export const STATE_POSTS = ['pending', 'rejected', 'revoked', 'deleted', 'unauthorized', 'muted_account']
  .map((state) => quoting(`s-${state}`, { state, quoted_status: null }))
