import type { Account, CaribouClient, Network, Relationship, Status } from './index.js'

/**
 * The network a post, account or relationship belongs to. A resource from
 * Bluesky has a `bluesky` field; one without it is Mastodon's. Spec 6.3,
 * seam 9.
 */
export function resourceNetwork(resource: Pick<Status | Account | Relationship, 'bluesky'>): Network {
  return resource.bluesky ? 'bluesky' : 'mastodon'
}

/**
 * Whether `client` can act on `resource` (like, follow, reply, read the
 * reader's relationship): only when both are on the same network. A
 * Mastodon resource also needs the client's own server; the caller checks
 * that, as before. Spec section 11.
 */
export function canActOn(
  client: Pick<CaribouClient, 'capabilities'> | null | undefined,
  resource: Pick<Status | Account | Relationship, 'bluesky'>,
): boolean {
  return !!client && client.capabilities.network === resourceNetwork(resource)
}
