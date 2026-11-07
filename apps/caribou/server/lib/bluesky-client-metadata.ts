// The atproto OAuth client metadata for the browser client (spec 5.2). The
// rules are in apps/caribou/README.md, "Bluesky sign-in endpoints".

export const CLIENT_METADATA_PATH = '/oauth/client-metadata.json'
export const BLUESKY_REDIRECT_PATH = '/signin/bluesky'

/**
 * The public origin from `PUBLIC_BASE_URL`, or null when it is unset or is
 * not a bare http(s) origin. Never the Host header: the `client_id` must be
 * the one URL an authorization server fetches.
 */
export function configuredOrigin(value = process.env.PUBLIC_BASE_URL): string | null {
  const raw = value?.trim().replace(/\/+$/, '')
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.origin !== raw) return null
  return url.origin
}

export function clientMetadata(origin: string) {
  return {
    client_id: `${origin}${CLIENT_METADATA_PATH}`,
    client_name: 'Caribou',
    client_uri: origin,
    redirect_uris: [`${origin}${BLUESKY_REDIRECT_PATH}`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'none',
    dpop_bound_access_tokens: true,
  }
}
