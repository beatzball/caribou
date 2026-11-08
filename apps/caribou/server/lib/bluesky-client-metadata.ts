// The atproto OAuth client metadata for the browser client (spec 5.2). The
// rules are in apps/caribou/README.md, "Bluesky sign-in endpoints".

export const CLIENT_METADATA_PATH = '/oauth/client-metadata.json'
export const BLUESKY_REDIRECT_PATH = '/signin/bluesky'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The public origin from `PUBLIC_BASE_URL`, or null when it is unset or
 * cannot be a `client_id` origin. Never the Host header: the `client_id`
 * must be the one URL an authorization server fetches. atproto requires
 * https with no port; a local host may use http and any port (local tests,
 * the CI smoke job).
 */
export function configuredOrigin(value = process.env.PUBLIC_BASE_URL): string | null {
  const raw = value?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
  if (raw.endsWith('?') || raw.endsWith('#')) return null
  if (LOCAL_HOSTS.has(url.hostname)) {
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  }
  if (url.protocol !== 'https:' || url.port !== '') return null
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
