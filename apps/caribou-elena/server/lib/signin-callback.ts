import { toUserKey } from '@beatzball/caribou-auth'
import { STATE_TTL_MS, appKey, stateKey, type OAuthApp, type StateEntry } from './storage.js'

export interface CompleteSigninDeps {
  storage: {
    getItem<T = unknown>(key: string): Promise<T | null>
    setItem<T = unknown>(key: string, value: T): Promise<void>
    removeItem(key: string): Promise<void>
  }
  exchangeCode(input: {
    server: string; code: string; clientId: string; clientSecret: string; redirectUri: string;
  }): Promise<string>
  verifyCredentials(input: { server: string; token: string }): Promise<{
    id: string; username: string; acct: string; [k: string]: unknown;
  }>
  now?: () => number
}

export type CompleteSigninResult =
  | { kind: 'ok';    location: string; server: string }
  | { kind: 'error'; location: string }

export interface CompleteSigninInput {
  code?: string
  state?: string
  error?: string
}

export async function completeSignin(input: CompleteSigninInput, deps: CompleteSigninDeps): Promise<CompleteSigninResult> {
  if (input.error) return { kind: 'error', location: '/?error=denied' }
  if (!input.code || !input.state) return { kind: 'error', location: '/?error=state_mismatch' }

  const now = (deps.now ?? Date.now)()
  const stateData = await deps.storage.getItem<StateEntry>(stateKey(input.state))
  await deps.storage.removeItem(stateKey(input.state))
  if (!stateData) return { kind: 'error', location: '/?error=state_mismatch' }
  if ((now - stateData.createdAt) > STATE_TTL_MS) return { kind: 'error', location: '/?error=state_mismatch' }

  const { server, origin } = stateData
  const app = await deps.storage.getItem<OAuthApp>(appKey(server, origin))
  if (!app) return { kind: 'error', location: `/?error=exchange_failed&instance=${encodeURIComponent(server)}` }

  let token: string
  try {
    token = await deps.exchangeCode({
      server,
      code: input.code,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      redirectUri: `${origin}/api/signin/callback`,
    })
  } catch {
    return { kind: 'error', location: `/?error=exchange_failed&instance=${encodeURIComponent(server)}` }
  }

  let account: Awaited<ReturnType<CompleteSigninDeps['verifyCredentials']>>
  try {
    account = await deps.verifyCredentials({ server, token })
  } catch {
    return { kind: 'error', location: '/?error=verify_failed' }
  }

  const userKey = toUserKey(account.username, server)
  const fragment = new URLSearchParams({
    token,
    server,
    userKey,
    vapidKey: app.vapid_key,
  }).toString()

  return { kind: 'ok', location: `/signin/done#${fragment}`, server }
}

export async function exchangeCodeForToken(input: {
  server: string; code: string; clientId: string; clientSecret: string; redirectUri: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    scope: 'read write follow push',
  })
  const res = await fetch(`https://${input.server}/oauth/token`, { method: 'POST', body })
  if (!res.ok) throw new Error(`oauth/token ${res.status}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

export async function verifyCredentialsFetch(input: { server: string; token: string }) {
  const res = await fetch(`https://${input.server}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${input.token}` },
  })
  if (!res.ok) throw new Error(`verify_credentials ${res.status}`)
  return (await res.json()) as { id: string; username: string; acct: string; [k: string]: unknown }
}
