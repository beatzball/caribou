import type { Page, Route } from '@playwright/test'

// A fixture atproto identity and authorization server for the Bluesky
// sign-in specs (spec 5.5). The browser runs the real SDK: it resolves the
// handle through Caribou's resolver, reads the DID document, the PDS's
// protected-resource metadata and the authorization server's metadata, sends
// PAR with PKCE and DPoP, follows the redirect, swaps the code and checks
// the `sub`. The test answers each of those requests as the servers would.
// No real account is named: the hosts are under `.test`.

export const ALICE = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa'
export const BOB = 'did:plc:bobbbbbbbbbbbbbbbbbbbbbb'
export const MALLORY = 'did:plc:malloryaaaaaaaaaaaaaaaaa'

const PDS = 'https://pds.example.test'
const ISSUER = 'https://auth.example.test'
const OTHER_PDS = 'https://other-pds.example.test'
const OTHER_ISSUER = 'https://other-auth.example.test'

const HANDLES: Record<string, string> = { 'alice.example.com': ALICE }

// Each DID's PDS. Mallory's PDS trusts another authorization server, so a
// token from ours naming Mallory fails the SDK's issuer check.
const PDS_OF: Record<string, string> = { [ALICE]: PDS, [BOB]: PDS, [MALLORY]: OTHER_PDS }
const HANDLE_OF: Record<string, string> = { [ALICE]: 'alice.example.com', [BOB]: 'bob.example.com', [MALLORY]: 'mallory.example.com' }

export interface FixtureAuth {
  /** The DID the token endpoint names as `sub`. Defaults to the login hint's DID. */
  sub: string | null
  /** Form bodies the token endpoint got, in order. */
  tokenRequests: URLSearchParams[]
  /** Tokens the revocation endpoint got. */
  revoked: string[]
  /** `Authorization` headers on XRPC calls to the PDS, by method. */
  pdsCalls: { method: string; authorization: string | null; dpop: boolean }[]
  /** When true, the PDS refuses every token (the session ended at the server). */
  revokedAtServer: boolean
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'DPoP-Nonce, WWW-Authenticate',
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function didDoc(did: string) {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
    alsoKnownAs: [`at://${HANDLE_OF[did]}`],
    verificationMethod: [{
      id: `${did}#atproto`, type: 'Multikey', controller: did,
      publicKeyMultibase: 'zQ3shXjHeiBuRCKmM36cuYnm7YEMzhGnCmCyW92sRJ9pribSF',
    }],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS_OF[did] }],
  }
}

function asMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    require_pushed_authorization_requests: true,
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'fragment'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_signing_alg_values_supported: ['ES256'],
    scopes_supported: ['atproto', 'transition:generic'],
    authorization_response_iss_parameter_supported: true,
    dpop_signing_alg_values_supported: ['ES256'],
    client_id_metadata_document_supported: true,
    subject_types_supported: ['public'],
  }
}

function profile(did: string) {
  return {
    did, handle: HANDLE_OF[did], displayName: 'Alice', description: '',
    followersCount: 1, followsCount: 1, postsCount: 0, indexedAt: '2026-11-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z', labels: [],
  }
}

/** Installs the fixture servers on `page`. */
export async function installFixtureAuth(page: Page, opts: { sub?: string } = {}): Promise<FixtureAuth> {
  const state: FixtureAuth = { sub: opts.sub ?? null, tokenRequests: [], revoked: [], pdsCalls: [], revokedAtServer: false }
  const pars = new Map<string, URLSearchParams>()
  const codes = new Map<string, URLSearchParams>()

  // Caribou's own handle resolver (#181 serves it; the test answers for it).
  await page.route('**/xrpc/com.atproto.identity.resolveHandle?*', (route) => {
    const handle = new URL(route.request().url()).searchParams.get('handle') ?? ''
    const did = HANDLES[handle]
    return did ? json(route, { did }) : json(route, { error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400)
  })

  await page.route('https://plc.directory/**', (route) => {
    const did = decodeURIComponent(new URL(route.request().url()).pathname.slice(1))
    return PDS_OF[did] ? json(route, didDoc(did)) : json(route, { message: 'DID not registered' }, 404)
  })

  for (const [pds, issuer] of [[PDS, ISSUER], [OTHER_PDS, OTHER_ISSUER]] as const) {
    await page.route(`${pds}/.well-known/oauth-protected-resource`, (route) =>
      json(route, { resource: pds, authorization_servers: [issuer], bearer_methods_supported: ['header'] }))
    await page.route(`${issuer}/.well-known/oauth-authorization-server`, (route) => json(route, asMetadata(issuer)))
  }

  await page.route(`${ISSUER}/oauth/par`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = new URLSearchParams(route.request().postData() ?? '')
    const requestUri = `urn:ietf:params:oauth:request_uri:req-${pars.size + 1}`
    pars.set(requestUri, body)
    return json(route, { request_uri: requestUri, expires_in: 300 }, 201)
  })

  // The approval page: the reader approves at once. The code goes back in
  // the fragment (`response_mode=fragment`).
  await page.route(`${ISSUER}/oauth/authorize?*`, (route) => {
    const requestUri = new URL(route.request().url()).searchParams.get('request_uri') ?? ''
    const par = pars.get(requestUri)
    if (!par) return route.fulfill({ status: 400, body: 'unknown request_uri' })
    const code = `code-${codes.size + 1}`
    codes.set(code, par)
    const back = new URLSearchParams({ state: par.get('state') ?? '', iss: ISSUER, code })
    return route.fulfill({ status: 302, headers: { location: `${par.get('redirect_uri')}#${back}` } })
  })

  await page.route(`${ISSUER}/oauth/token`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = new URLSearchParams(route.request().postData() ?? '')
    state.tokenRequests.push(body)
    const par = codes.get(body.get('code') ?? '')
    if (body.get('grant_type') !== 'authorization_code' || !par) return json(route, { error: 'invalid_grant' }, 400)
    const hint = par.get('login_hint') ?? ''
    const sub = state.sub ?? (hint.startsWith('did:') ? hint : HANDLES[hint] ?? ALICE)
    return json(route, {
      access_token: `access-${sub}`, token_type: 'DPoP', expires_in: 3600,
      refresh_token: `refresh-${sub}`, scope: 'atproto transition:generic', sub,
    })
  })

  await page.route(`${ISSUER}/oauth/revoke`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    state.revoked.push(new URLSearchParams(route.request().postData() ?? '').get('token') ?? '')
    return route.fulfill({ status: 200, headers: CORS, body: '' })
  })

  await page.route(`${PDS}/xrpc/**`, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const method = url.pathname.replace('/xrpc/', '')
    const headers = req.headers()
    state.pdsCalls.push({ method, authorization: headers['authorization'] ?? null, dpop: !!headers['dpop'] })
    if (state.revokedAtServer) {
      return route.fulfill({
        status: 401,
        headers: { ...CORS, 'content-type': 'application/json', 'www-authenticate': 'DPoP error="invalid_token"' },
        body: JSON.stringify({ error: 'invalid_token', message: 'token revoked' }),
      })
    }
    switch (method) {
      case 'app.bsky.actor.getProfile': return json(route, profile(url.searchParams.get('actor') ?? ALICE))
      case 'app.bsky.actor.getPreferences': return json(route, { preferences: [] })
      case 'app.bsky.actor.putPreferences': return route.fulfill({ status: 200, headers: CORS, body: '' })
      case 'app.bsky.labeler.getServices': return json(route, { views: [] })
      case 'app.bsky.feed.getTimeline': return json(route, { feed: [] })
      default: return json(route, { error: 'MethodNotImplemented' }, 501)
    }
  })

  return state
}

/** The app's origin with the loopback IP: the loopback client's redirect goes there. */
export function loopbackOrigin(baseURL: string | undefined): string {
  const url = new URL(baseURL ?? 'http://localhost:3000')
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.origin
}
