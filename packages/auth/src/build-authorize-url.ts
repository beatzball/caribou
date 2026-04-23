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
  return u.toString()
}
