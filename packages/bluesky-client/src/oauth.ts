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
export type OAuthLike = Pick<BrowserOAuthClient, 'signIn' | 'initCallback' | 'restore'>

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

/** The account that signed in is not the one the handle or DID named. */
export class SignInMismatch extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super('You signed in to another account than the one you entered')
    this.name = 'SignInMismatch'
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
const deletedListeners = new Map<string, Set<() => void>>()

/** The page's SDK client (README: "One OAuth client per page"). */
export function loadOAuthClient(config: BlueskyOAuthConfig): Promise<BrowserOAuthClient> {
  const key = JSON.stringify(config)
  if (shared?.key === key) return shared.client
  const client = BrowserOAuthClient.load({
    clientId: config.clientId,
    handleResolver: config.handleResolver,
    responseMode: 'fragment',
    onSessionDeleted: (sub: string) => {
      for (const fn of deletedListeners.get(sub) ?? []) fn()
    },
  })
  shared = { key, client }
  client.catch(() => { if (shared?.client === client) shared = null })
  return client
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
  await oauth.signIn(expected ?? input.value, { scope: BLUESKY_SCOPE, state: JSON.stringify(state) })
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
  oauth: Pick<OAuthLike, 'initCallback'>,
  opts: { agent?: (s: OAuthSession) => Pick<Agent, 'getProfile'> } = {},
): Promise<CompletedSignIn> {
  const { session, state: rawState } = await oauth.initCallback()
  const state = readState(rawState)
  // A callback without our state did not start here: store nothing.
  if (!state) {
    await session.signOut().catch(() => {})
    throw new Error('This sign-in did not start in Caribou')
  }
  if (state.expected && state.expected !== session.did) {
    await session.signOut().catch(() => {})
    throw new SignInMismatch(state.expected, session.did)
  }
  const info = await session.getTokenInfo(false)
  const pds = String(info.aud)
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
  const listeners = deletedListeners.get(did) ?? new Set()
  listeners.add(opts.onExpired)
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
    ...(opts.onMapError ? { onMapError: opts.onMapError } : {}),
  })
  return { client, agent, prefs, labelDefs }
}

/** Revokes the session for `did` and deletes its tokens. No stored session: nothing to do. */
export async function signOut(oauth: Pick<OAuthLike, 'restore'>, did: string): Promise<void> {
  let session: OAuthSession
  try {
    session = await oauth.restore(did, false)
  } catch (err) {
    if (isGone(err)) return
    throw err
  }
  await session.signOut()
}
