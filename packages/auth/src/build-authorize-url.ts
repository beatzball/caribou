export interface BuildAuthorizeUrlInput {
  server: string            // "fosstodon.org" (scheme optional; stripped if present)
  clientId: string
  redirectUri: string
  scope: string             // e.g. "read write follow push"
  state: string
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const bareServer = input.server.replace(/^https?:\/\//, '').trim()
  if (!bareServer) throw new Error('buildAuthorizeUrl: server is required')
  const u = new URL(`https://${bareServer}/oauth/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', input.clientId)
  u.searchParams.set('redirect_uri', input.redirectUri)
  u.searchParams.set('scope', input.scope)
  u.searchParams.set('state', input.state)
  // Mastodon-specific: always show the login/account picker, even if the
  // user already has an active Mastodon session and previously authorized
  // this OAuth app. Without it, signing out of Caribou and re-entering the
  // same domain silently re-authorizes the same account — blocking the user
  // from switching to a different account on the same instance.
  u.searchParams.set('force_login', 'true')
  return u.toString()
}
