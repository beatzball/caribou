// Server-safe: no SDK import.

/** The response header that names the labelers whose labels an AppView answer carries. */
export const CONTENT_LABELERS_HEADER = 'atproto-content-labelers'

/**
 * The labeler DIDs in an `atproto-content-labelers` value
 * (`did:plc:a;redact, did:web:b`): each item's DID, without its parameters.
 * Missing or unreadable is `[]`, which never settles the reader veil.
 */
export function parseContentLabelers(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const out: string[] = []
  for (const item of value.split(',')) {
    const did = item.split(';')[0]!.trim()
    if (/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(did) && !out.includes(did)) out.push(did)
  }
  return out
}

/**
 * The most labelers Caribou counts from one request's
 * `atproto-accept-labelers` (README, "Labeler coverage"). The AppView
 * source sets no cap; this is the Bluesky app's `MAX_LABELERS`
 * (`bluesky-social/social-app`, `src/lib/constants.ts`).
 */
export const ACCEPTED_LABELERS_LIMIT = 20

/**
 * The labelers a request counts as sent: each valid DID once, in the order
 * sent, the first `ACCEPTED_LABELERS_LIMIT` only.
 */
export function acceptedLabelers(sent: readonly unknown[] | undefined): string[] {
  const out: string[] = []
  for (const item of sent ?? []) {
    for (const did of parseContentLabelers(item)) {
      if (out.length === ACCEPTED_LABELERS_LIMIT) return out
      if (!out.includes(did)) out.push(did)
    }
  }
  return out
}

/**
 * One successful answer's coverage (README, "Labeler coverage"): the
 * `atproto-content-labelers` header when it can be read; otherwise the
 * labelers the request sent, as counted when it started and when it landed.
 */
export function answerCoverage(
  headers: Record<string, string | undefined> | undefined,
  sentAtStart: readonly unknown[] | undefined,
  sentAtEnd: readonly unknown[] | undefined,
): string[] {
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === CONTENT_LABELERS_HEADER) return parseContentLabelers(v ?? '')
  }
  const end = acceptedLabelers(sentAtEnd)
  return acceptedLabelers(sentAtStart).filter((did) => end.includes(did))
}

/** Several answers: only the labelers every one of them covered. None is `[]`. */
export function commonLabelers(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return []
  const [first, ...rest] = lists
  return first!.filter((did) => rest.every((r) => r.includes(did)))
}
