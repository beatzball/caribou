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

/** The labelers an XRPC answer covered, from its headers (any case). */
export function labelersCoveredBy(headers: Record<string, string | undefined> | undefined): string[] {
  if (!headers) return []
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === CONTENT_LABELERS_HEADER) return parseContentLabelers(v)
  }
  return []
}
