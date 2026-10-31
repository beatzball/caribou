import { toUserKey } from '@beatzball/caribou-auth'
import { nonceMatches } from './signin-binding.js'
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
  // From the browser's `caribou.signin` cookie (`signin-binding.ts`).
  nonce?: string
}

export async function completeSignin(input: CompleteSigninInput, deps: CompleteSigninDeps): Promise<CompleteSigninResult> {
  // The state entry is read (and used up) first, also for an error: it says
  // whether the reader was adding an account. Mastodon sends `state` back
  // with a denial too.
  const stored = input.state ? await deps.storage.getItem<StateEntry>(stateKey(input.state)) : null
  if (input.state) await deps.storage.removeItem(stateKey(input.state))
  // The state counts only in the browser that started the sign-in (its
  // `caribou.signin` cookie). Otherwise a stranger could start a sign-in to
  // their own account and hand the callback URL to this reader, whose
  // browser would store and activate the stranger's account. A state that
  // fails this check is still used up, and no token exchange runs.
  const stateData = stored && nonceMatches(input.nonce, stored.nonceHash) ? stored : null
  // An add keeps the reader on the add form, signed in as before (also on a
  // mismatch: the stored entry asked for it, and the target is a fixed path).
  const fail = (code: string) => ({
    kind: 'error' as const, location: `/?${stored?.add ? 'add&' : ''}error=${code}`,
  })

  if (input.error) return fail('denied')
  if (!input.code || !stateData) return fail('state_mismatch')

  const now = (deps.now ?? Date.now)()
  if ((now - stateData.createdAt) > STATE_TTL_MS) return fail('state_mismatch')

  const { server, origin } = stateData
  const app = await deps.storage.getItem<OAuthApp>(appKey(server, origin))
  if (!app) return fail(`exchange_failed&instance=${encodeURIComponent(server)}`)

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
    return fail(`exchange_failed&instance=${encodeURIComponent(server)}`)
  }

  let account: Awaited<ReturnType<CompleteSigninDeps['verifyCredentials']>>
  try {
    account = await deps.verifyCredentials({ server, token })
  } catch {
    return fail('verify_failed')
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
