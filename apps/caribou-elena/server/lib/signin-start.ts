import { buildAuthorizeUrl, generateState as defaultGenerateState } from '@beatzball/caribou-auth'
import { APP_TTL_MS, STATE_TTL_MS, appKey, stateKey, type OAuthApp, type StateEntry } from './storage.js'

export interface StartSigninDeps {
  storage: {
    getItem<T = unknown>(key: string): Promise<T | null>
    setItem<T = unknown>(key: string, value: T): Promise<void>
    removeItem(key: string): Promise<void>
  }
  registerApp(input: { server: string; redirectUri: string }): Promise<{
    client_id: string; client_secret: string; vapid_key: string;
  }>
  generateState?: () => string
  now?: () => number
}

export interface StartSigninInput {
  server: string
  origin: string
}

export interface StartSigninOutput {
  authorizeUrl: string
}

const SCOPES = 'read write follow push'

export async function startSignin(input: StartSigninInput, deps: StartSigninDeps): Promise<StartSigninOutput> {
  const server = input.server.replace(/^https?:\/\//, '').trim()
  if (!server) throw new Error('startSignin: server is required')
  const origin = input.origin
  if (!origin) throw new Error('startSignin: origin is required')

  const now = (deps.now ?? Date.now)()
  const redirectUri = `${origin}/api/signin/callback`

  let app = await deps.storage.getItem<OAuthApp>(appKey(server, origin))
  if (!app || (now - app.registered_at) > APP_TTL_MS) {
    const registered = await deps.registerApp({ server, redirectUri })
    app = { ...registered, registered_at: now }
    await deps.storage.setItem(appKey(server, origin), app)
  }

  const state = (deps.generateState ?? defaultGenerateState)()
  const stateEntry: StateEntry = { server, origin, createdAt: now }
  await deps.storage.setItem(stateKey(state), stateEntry)

  const authorizeUrl = buildAuthorizeUrl({
    server,
    clientId: app.client_id,
    redirectUri,
    scope: SCOPES,
    state,
  })

  void STATE_TTL_MS

  return { authorizeUrl }
}

export async function registerMastodonApp(input: { server: string; redirectUri: string }) {
  const url = `https://${input.server}/api/v1/apps`
  const body = new URLSearchParams({
    client_name: 'Caribou',
    redirect_uris: input.redirectUri,
    scopes: SCOPES,
    website: 'https://caribou.quest',
  })
  const res = await fetch(url, { method: 'POST', body })
  if (!res.ok) throw new Error(`register app failed: ${res.status}`)
  const json = (await res.json()) as { client_id: string; client_secret: string; vapid_key?: string }
  return {
    client_id: json.client_id,
    client_secret: json.client_secret,
    vapid_key: json.vapid_key ?? '',
  }
}
