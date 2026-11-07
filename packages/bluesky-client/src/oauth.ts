// Sign-in, callback, restore and sign-out over the browser SDK. Browser
// only: it loads through `./browser`, in the lazy chunk. The rules are in the
// README ("Sign-in and sessions").
import { Agent, BSKY_LABELER_DID, type AppBskyActorDefs, type ModerationPrefs } from '@atproto/api'
import {
  BrowserOAuthClient, TokenInvalidError, TokenRefreshError, TokenRevokedError,
  type OAuthSession,
} from '@atproto/oauth-client-browser'
import type { UserKey } from '@beatzball/caribou-auth'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { createBlueskyClient, type BlueskyAgent } from './client.js'
import { labelDefsFromServices, moderate, type LabelDefs } from './moderation.js'

export const BLUESKY_SCOPE = 'atproto transition:generic'

export interface BlueskyOAuthConfig {
  /** The loopback client id, or `<origin>/oauth/client-metadata.json`. */
  clientId: string
  /** Caribou's own origin: it answers `com.atproto.identity.resolveHandle`. */
  handleResolver: string
}

/** The parts of the SDK client this module calls. Tests pass a fake. */
export type OAuthLike = Pick<BrowserOAuthClient, 'signIn' | 'initCallback' | 'restore' | 'revoke'>
  & Partial<Pick<BrowserOAuthClient, 'readCallbackParams'>>

/** IndexedDB cannot be opened (some private windows). */
export class StorageUnavailable extends Error {
  constructor() {
    super('Bluesky sign-in needs site storage')
    this.name = 'StorageUnavailable'
  }
}

/** What the reader typed is not a handle, a DID or a server address. */
export class InvalidSignInInput extends Error {
  constructor() {
    super('Enter a Bluesky handle, a DID or a server address')
    this.name = 'InvalidSignInInput'
  }
}

/**
 * A callback the app refuses after the SDK stored its session. `actual` is
 * the DID that signed in. `kept`: that DID is already a Caribou account and
 * its new session stays (state rule 11); else the new session was revoked.
 */
export class SignInRejected extends Error {
  constructor(message: string, readonly actual: string, readonly kept: boolean) {
    super(message)
    this.name = 'SignInRejected'
  }
}

/** The account that signed in is not the one the handle or DID named. */
export class SignInMismatch extends SignInRejected {
  constructor(readonly expected: string, actual: string, kept: boolean) {
    super('You signed in to another account than the one you entered', actual, kept)
    this.name = 'SignInMismatch'
  }
}

/** A callback whose state Caribou did not make. */
export class ForeignCallback extends SignInRejected {
  constructor(actual: string, kept: boolean) {
    super('This sign-in did not start in Caribou', actual, kept)
    this.name = 'ForeignCallback'
  }
}

/** The callback URL has no parameters: a bookmark, or a reload after it was used. */
export class NoCallbackParams extends Error {
  constructor() {
    super('This sign-in link was already used or has expired')
    this.name = 'NoCallbackParams'
  }
}

/** The reader came back from the authorization page without approving. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled')
    this.name = 'SignInCancelled'
  }
}

/** The SDK says the session is gone. Restoring it again will not help. */
export class SessionGone extends Error {
  constructor(cause: unknown) {
    super('Bluesky session ended', { cause })
    this.name = 'SessionGone'
  }
}

// One client per page, keyed by its config.
let shared: { key: string; client: Promise<BrowserOAuthClient> } | null = null
// The deleted listeners: one per DID and sign-in (`RestoreOptions.key`).
const deletedListeners = new Map<string, Map<string, () => void>>()

/** How long a sign-out lets any SDK request run (README: "Sign-out"). */
export const SIGN_OUT_TIMEOUT_MS = 5000

// While a sign-out runs, the time after which every SDK request is cut off.
let cutOffAt: number | null = null

/**
 * The fetch the SDK uses. Outside a sign-out it is plain `fetch`. During one
 * every request is aborted at the cut-off, so a revoke that hangs still ends
 * and the SDK deletes the stored tokens in its `finally`.
 */
export function sdkFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (cutOffAt === null) return fetch(input, init)
  const timeout = AbortSignal.timeout(Math.max(0, cutOffAt - Date.now()))
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

/** The page's SDK client (README: "One OAuth client per page"). */
export function loadOAuthClient(config: BlueskyOAuthConfig): Promise<BrowserOAuthClient> {
  const key = JSON.stringify(config)
  if (shared?.key === key) return shared.client
  const client = BrowserOAuthClient.load({
    clientId: config.clientId,
    handleResolver: config.handleResolver,
    responseMode: 'fragment',
    fetch: sdkFetch,
    onSessionDeleted: (sub: string) => { notifySessionDeleted(sub) },
  })
  shared = { key, client }
  client.catch(() => { if (shared?.client === client) shared = null })
  return client
}

/** The SDK's deleted event for `sub` (here or in another tab). */
export function notifySessionDeleted(sub: string): void {
  for (const fn of [...deletedListeners.get(sub)?.values() ?? []]) fn()
}

export type SignInInput =
  | { kind: 'did'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'pds'; value: string }

const HANDLE_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%:-]+)$/

/** What the reader typed, sorted (README: "What the reader types"). */
export function parseSignInInput(raw: string): SignInInput {
  const text = raw.trim()
  if (DID_RE.test(text)) return { kind: 'did', value: text }
  if (/^https:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      if (url.protocol === 'https:' && HANDLE_RE.test(url.hostname)) return { kind: 'pds', value: url.origin }
    } catch { /* below */ }
    throw new InvalidSignInInput()
  }
  const handle = text.replace(/^@/, '').toLowerCase()
  if (handle.length <= 253 && HANDLE_RE.test(handle)) return { kind: 'handle', value: handle }
  throw new InvalidSignInInput()
}

/** Throws `StorageUnavailable` when IndexedDB cannot be opened. */
export async function assertStorage(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (!idb) throw new StorageUnavailable()
  await new Promise<void>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = idb.open('caribou-storage-check')
    } catch {
      reject(new StorageUnavailable())
      return
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(new StorageUnavailable())
    req.onblocked = () => resolve()
  })
}

/** Caribou's resolver: the handle's DID. */
export async function resolveHandle(
  handleResolver: string, handle: string, doFetch: typeof fetch = fetch,
): Promise<string> {
  const url = new URL('/xrpc/com.atproto.identity.resolveHandle', handleResolver)
  url.searchParams.set('handle', handle)
  const res = await doFetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Could not find ${handle}`)
  const body = await res.json() as { did?: unknown }
  if (typeof body.did !== 'string' || !DID_RE.test(body.did)) throw new Error(`Could not find ${handle}`)
  return body.did
}

interface SignInState {
  /** The DID the typed handle or DID named; absent for a PDS host. */
  expected?: string
  /** What the reader typed, for the handle when the profile read fails. */
  input: string
}

/**
 * Starts a sign-in: checks storage, finds the expected DID and sends the
 * reader to their authorization server. Resolves never on success (the page
 * navigates away).
 */
export async function beginSignIn(
  oauth: Pick<OAuthLike, 'signIn'>, raw: string,
  opts: { handleResolver: string; fetch?: typeof fetch; indexedDB?: IDBFactory },
): Promise<void> {
  const input = parseSignInInput(raw)
  await assertStorage(opts.indexedDB)
  let expected: string | undefined
  if (input.kind === 'did') expected = input.value
  else if (input.kind === 'handle') expected = await resolveHandle(opts.handleResolver, input.value, opts.fetch)
  const state: SignInState = { input: input.value, ...(expected ? { expected } : {}) }
  try {
    await oauth.signIn(expected ?? input.value, { scope: BLUESKY_SCOPE, state: JSON.stringify(state) })
  } catch (err) {
    // The SDK's redirect rejects with this when the page is still there 5 s
    // later: the reader came back without approving.
    if (err instanceof Error && err.message === 'User navigated back') throw new SignInCancelled()
    throw err
  }
}

export interface CompletedSignIn {
  did: string
  handle: string
  pds: string
  profile: AppBskyActorDefs.ProfileViewDetailed | null
}

function readState(raw: string | null): SignInState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SignInState>
    if (typeof parsed.input !== 'string') return null
    return { input: parsed.input, ...(typeof parsed.expected === 'string' ? { expected: parsed.expected } : {}) }
  } catch {
    return null
  }
}

/**
 * Finishes a sign-in on the callback page: one `initCallback()`, the `sub`
 * check, then the profile. Throws `SignInMismatch` after it revoked a
 * session for another account.
 */
export async function completeSignIn(
  oauth: Pick<OAuthLike, 'initCallback' | 'revoke' | 'readCallbackParams'>,
  opts: {
    agent?: (s: OAuthSession) => Pick<Agent, 'getProfile'>
    /** Whether `did` is already a Caribou account. */
    isKnown?: (did: string) => boolean
  } = {},
): Promise<CompletedSignIn> {
  // Asked first, so a bookmark or a reload gets its own message.
  if (oauth.readCallbackParams && !oauth.readCallbackParams()) throw new NoCallbackParams()
  const { session, state: rawState } = await oauth.initCallback()
  const state = readState(rawState)
  // A failed attempt never changes another account's session. The SDK has
  // already revoked this DID's earlier session and stored the new one; for a
  // Caribou account, that one is now its session and stays.
  const refuse = async (make: (kept: boolean) => SignInRejected): Promise<never> => {
    const kept = opts.isKnown?.(session.did) ?? false
    if (!kept) await oauth.revoke(session.did).catch(() => {})
    throw make(kept)
  }
  // A callback without our state did not start here: store nothing.
  if (!state) return refuse((kept) => new ForeignCallback(session.did, kept))
  const expected = state.expected
  if (expected && expected !== session.did) return refuse((kept) => new SignInMismatch(expected, session.did, kept))
  const info = await session.getTokenInfo(false)
  // The token's audience is the PDS. Keep its origin: no trailing slash.
  const pds = new URL(String(info.aud)).origin
  let profile: AppBskyActorDefs.ProfileViewDetailed | null = null
  try {
    const agent = opts.agent ? opts.agent(session) : new Agent(session)
    profile = (await agent.getProfile({ actor: session.did })).data
  } catch {
    profile = null
  }
  const handle = profile?.handle && profile.handle !== 'handle.invalid'
    ? profile.handle
    : state.expected ? (state.input.startsWith('did:') ? session.did : state.input) : session.did
  return { did: session.did, handle, pds, profile }
}

function isGone(err: unknown): boolean {
  return err instanceof TokenRefreshError || err instanceof TokenRevokedError
    || err instanceof TokenInvalidError
  // The SDK's AuthMethodUnsatisfiableError is not exported. On it, the SDK
  // deletes the stored session, so the next restore throws TokenRefreshError.
}

export interface RestoredClient {
  client: CaribouClient
  agent: Agent
  /** The reader's moderation prefs, `null` when they failed to load. */
  prefs: ModerationPrefs | null
  /** Label definitions by labeler DID, `null` when they failed to load. */
  labelDefs: LabelDefs | null
}

export interface RestoreOptions {
  userKey: UserKey
  /** Names the sign-in (its `generation`). A new key drops the earlier listeners. */
  key: string
  /** The SDK said later that this session is gone (its deleted event). */
  onExpired: () => void
  onMapError?: (err: unknown, uri: string) => void
}

/**
 * Restores the session for `did` and builds its client (README: "Restore").
 * Throws `SessionGone` when the SDK says the session is gone.
 */
export async function restoreClient(
  oauth: Pick<OAuthLike, 'restore'>, did: string, opts: RestoreOptions,
): Promise<RestoredClient> {
  let session: OAuthSession
  try {
    session = await oauth.restore(did)
  } catch (err) {
    if (isGone(err)) throw new SessionGone(err)
    throw err
  }
  // The deleted event can be late: a restore that started before a new
  // sign-in to the same DID stored its tokens finds nothing and reports the
  // session deleted. So check: only when no session can be restored now is
  // this one gone. A failed check that is not "gone" (offline) changes
  // nothing (rule 5). The check's own failure reports "deleted" again; it
  // is ignored while the check runs.
  // One listener per DID and sign-in: a new sign-in supersedes the others.
  const listeners = new Map([...deletedListeners.get(did) ?? []].filter(([k]) => k === opts.key))
  let checking = false
  const onDeleted = () => {
    if (checking) return
    checking = true
    oauth.restore(did, false).then(
      () => { checking = false },
      (err: unknown) => {
        checking = false
        if (!isGone(err)) return
        if (listeners.get(opts.key) === onDeleted) listeners.delete(opts.key)
        opts.onExpired()
      },
    )
  }
  listeners.set(opts.key, onDeleted)
  deletedListeners.set(did, listeners)

  const agent = new Agent(session)
  const prefs = await agent.getPreferences().then((p) => p.moderationPrefs, () => null)
  const labelerDids = [...new Set([BSKY_LABELER_DID, ...(prefs?.labelers ?? []).map((l) => l.did)])]
  agent.configureLabelers(labelerDids)
  const labelDefs = await agent.app.bsky.labeler.getServices({ dids: labelerDids, detailed: true })
    .then((r) => labelDefsFromServices(r.data.views as Parameters<typeof labelDefsFromServices>[0]), () => null)

  const client = createBlueskyClient({
    userKey: opts.userKey,
    agent: agent as unknown as BlueskyAgent,
    moderation: {
      post: (view) => moderate({ kind: 'post', view }, did, prefs, labelDefs),
      profile: (view) => moderate({ kind: 'profile', view }, did, prefs, labelDefs),
    },
    // Any 401 ends the session (README: "401"), not only the challenged
    // one the SDK deletes the session for.
    onUnauthorized: opts.onExpired,
    ...(opts.onMapError ? { onMapError: opts.onMapError } : {}),
  })
  return { client, agent, prefs, labelDefs }
}

/**
 * Revokes the session for `did` and deletes its stored tokens (README:
 * "Sign-out"). The SDK's `revoke` deletes them in a `finally`, also when the
 * issuer cannot be reached; while it runs, SDK requests are cut off after
 * `timeoutMs`. No stored session: nothing to do.
 */
export async function signOut(
  oauth: Pick<OAuthLike, 'revoke'>, did: string, opts: { timeoutMs?: number } = {},
): Promise<void> {
  cutOffAt = Date.now() + (opts.timeoutMs ?? SIGN_OUT_TIMEOUT_MS)
  try {
    await oauth.revoke(did)
  } finally {
    cutOffAt = null
  }
}
