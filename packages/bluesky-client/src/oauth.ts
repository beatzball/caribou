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
import { detectFacets, nextRkey } from './compose.js'
import { normalizeXrpcError } from './errors.js'
import { goneLabelers, labelDefsFromServices, readerModerationSource, type LabelDefs } from './moderation.js'
import { applyMutedWordEdit, checkMutedWordEdit, type MutedWordEdit, type MutedWordOutcome } from './muted-words.js'

export { InvalidMutedWord, type MutedWordEdit, type MutedWordOutcome } from './muted-words.js'

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

/** The page's SDK client (README: "One OAuth client per page"). */
export function loadOAuthClient(config: BlueskyOAuthConfig): Promise<BrowserOAuthClient> {
  const key = JSON.stringify(config)
  if (shared?.key === key) return shared.client
  const client = BrowserOAuthClient.load({
    clientId: config.clientId,
    handleResolver: config.handleResolver,
    responseMode: 'fragment',
    onSessionDeleted: (sub: string) => { notifySessionDeleted(sub) },
  }).then((c) => {
    // Every write of a session goes through the guard (README: "Sign-out").
    guardSessionStore(c)
    return c
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
  // A new sign-in for this DID: its writes are allowed again.
  if (expected) allowSessionWrites(expected)
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
  /**
   * Loads the prefs and the definitions again (a cover's Retry). Later
   * decisions of this client use the new ones; `prefs` and `labelDefs`
   * above follow too.
   */
  reloadModeration(): Promise<ModerationInputs>
  /**
   * Checks the definitions again, for the labelers the prefs name now
   * (README, "Labeler coverage"). A labeler `getServices` no longer answers
   * for loses its definitions at once, so the veil covers again. A failed
   * check changes nothing; a 401 ends the session.
   */
  recheckLabelers(): Promise<ModerationInputs>
  /**
   * The labelers in the prefs with no definitions now (`goneLabelers`,
   * README "A gone labeler"). Follows the loads and checks above.
   */
  gone: string[]
  /**
   * Removes one gone labeler from the reader's prefs (README, "A gone
   * labeler"). Call it only after the reader confirmed. Throws, writing
   * nothing, for a DID not in `gone` or when the last check fails.
   */
  removeGoneLabeler(did: string): Promise<ModerationInputs & { outcome: 'removed' | 'back' | 'absent' }>
  /**
   * Adds or removes one muted word (README, "Muted words"). One job in the
   * moderation queue: a fresh read under the prefs lock, the write, then a
   * full load. Throws `InvalidMutedWord` with no request for an add rule 6
   * refuses; throws on a failed read or write.
   */
  editMutedWords(edit: MutedWordEdit): Promise<MutedWordsResult>
}

/** What a muted-words write leaves. `reloadFailed`: written, but the load after it failed. */
export interface MutedWordsResult extends ModerationInputs {
  outcome: MutedWordOutcome
  reloadFailed: boolean
}

/** What a moderation load or check leaves: the inputs and the gone labelers. */
export interface ModerationInputs {
  prefs: ModerationPrefs | null
  labelDefs: LabelDefs | null
  gone: string[]
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
  // The moderation inputs. Either failing to load is null: fail closed.
  let prefs: ModerationPrefs | null = null
  let labelDefs: LabelDefs | null = null
  // Missing is null (fail closed). A 401 also ends the session (README:
  // "401"); a network error or a 5xx does not.
  const failed = (err: unknown): null => {
    if (normalizeXrpcError(err).code === 'unauthorized') opts.onExpired()
    return null
  }
  const labelerDidsOf = (p: ModerationPrefs | null) => [...new Set([BSKY_LABELER_DID, ...(p?.labelers ?? []).map((l) => l.did)])]
  const loadDefs = (dids: string[]) => agent.app.bsky.labeler.getServices({ dids, detailed: true })
    .then((r) => labelDefsFromServices(r.data.views as Parameters<typeof labelDefsFromServices>[0]), failed)
  // One at a time (README, "A gone labeler", rule Q): every load, check
  // and removal is one job in this queue. A load or check asked for while
  // one of its kind waits (not started) joins it.
  let tail: Promise<unknown> = Promise.resolve()
  const waiting = new Map<'load' | 'check', Promise<ModerationInputs>>()
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job)
    tail = run.catch(() => {})
    return run
  }
  function queued(kind: 'load' | 'check', job: () => Promise<void>): Promise<ModerationInputs> {
    const joined = waiting.get(kind)
    if (joined) return joined
    const run = enqueue(async () => {
      waiting.delete(kind)
      await job()
      return inputs()
    })
    waiting.set(kind, run)
    return run
  }
  // Misses in a row, by labeler DID: two make it gone.
  const misses = new Map<string, number>()
  function countMisses() {
    if (!prefs || !labelDefs) return
    const missing = new Set(goneLabelers(prefs, labelDefs))
    for (const did of [...misses.keys()]) if (!missing.has(did)) misses.delete(did)
    for (const did of missing) misses.set(did, (misses.get(did) ?? 0) + 1)
  }
  // Run only inside a queue job.
  async function loadModeration() {
    prefs = await agent.getPreferences().then((r) => r.moderationPrefs, failed)
    const labelerDids = labelerDidsOf(prefs)
    agent.configureLabelers(labelerDids)
    labelDefs = await loadDefs(labelerDids)
    countMisses()
  }
  // Only a successful answer replaces the definitions: a labeler it has no
  // view for (taken down, gone) then has none, and the veil covers again.
  // Run only inside a queue job.
  async function recheckLabelers() {
    const fresh = await loadDefs(labelerDidsOf(prefs))
    if (!fresh) return
    labelDefs = fresh
    countMisses()
  }

  const client = createBlueskyClient({
    userKey: opts.userKey,
    agent: agent as unknown as BlueskyAgent,
    // Each read passes its answer's labeler coverage: the header when the
    // browser can read it, else the labelers `configureLabelers` above sent
    // (README, "Labeler coverage").
    moderation: readerModerationSource(did, () => ({ prefs, labelDefs })),
    // Any 401 ends the session (README: "401"), not only the challenged
    // one the SDK deletes the session for.
    onUnauthorized: opts.onExpired,
    compose: { nextRkey, detectFacets: (text) => detectFacets(agent, text) },
    ...(opts.onMapError ? { onMapError: opts.onMapError } : {}),
  })
  const goneNow = () => goneLabelers(prefs, labelDefs).filter((did) => (misses.get(did) ?? 0) >= 2)
  const inputs = (): ModerationInputs => {
    out.prefs = prefs
    out.labelDefs = labelDefs
    out.gone = goneNow()
    return { prefs, labelDefs, gone: out.gone }
  }
  const out: RestoredClient = {
    client, agent, prefs: null, labelDefs: null, gone: [],
    reloadModeration: () => queued('load', loadModeration),
    recheckLabelers: () => queued('check', recheckLabelers),
    removeGoneLabeler(did) {
      if (!out.gone.includes(did)) return Promise.reject(new Error(`Bluesky: ${did} is not a gone labeler`))
      return enqueue(() => removeGone(did))
    },
    editMutedWords(edit) {
      let checked: MutedWordEdit
      try {
        checked = checkMutedWordEdit(edit)
      } catch (err) {
        return Promise.reject(err)
      }
      return enqueue(() => editMuted(checked))
    },
  }
  await out.reloadModeration()
  return out

  // One job: the write (a fresh read under the prefs lock) and the reload.
  async function editMuted(edit: MutedWordEdit): Promise<MutedWordsResult> {
    // Set inside the edit, which the SDK calls under its lock.
    const seen: { outcome: MutedWordOutcome } = { outcome: 'absent' }
    await prefsWriter(agent)((all) => {
      const r = applyMutedWordEdit(all, edit)
      seen.outcome = r.outcome
      return r.prefs
    }).catch((err: unknown): never => {
      failed(err)
      throw err
    })
    const { outcome } = seen
    if (outcome !== 'added' && outcome !== 'removed') return { ...inputs(), outcome, reloadFailed: false }
    await loadModeration()
    return { ...inputs(), outcome, reloadFailed: prefs === null }
  }

  // One job: the "is it back" check, the write and the reload.
  async function removeGone(did: string): Promise<ModerationInputs & { outcome: 'removed' | 'back' | 'absent' }> {
      // A load in front of this job saw it: no check, no write.
      if (!goneNow().includes(did)) {
        return { ...inputs(), outcome: prefs?.labelers.some((l) => l.did === did) ? 'back' : 'absent' }
      }
      // A 401 ends the session (README: "401"); any failure throws.
      const ended = (err: unknown): never => {
        failed(err)
        throw err
      }
      // Once more: a labeler that came back is kept. A failed check throws.
      const check = await agent.app.bsky.labeler.getServices({ dids: [did], detailed: true }).catch(ended)
      if (check.data.views.some((v) => (v as { creator?: { did?: string } }).creator?.did === did)) {
        await recheckLabelers()
        return { ...inputs(), outcome: 'back' }
      }
      // A fresh read under the agent's prefs lock; only this DID changes.
      let found = false
      await prefsWriter(agent)((all) => {
        const next = all.map((pref) => {
          if (pref.$type !== LABELERS_PREF || !Array.isArray(pref.labelers)) return pref
          const before = pref.labelers as { did?: unknown }[]
          const labelers = before.filter((l) => l?.did !== did)
          if (labelers.length === before.length) return pref
          found = true
          return { ...pref, labelers }
        })
        return found ? next : false
      }).catch(ended)
      await loadModeration()
      return { ...inputs(), outcome: found ? 'removed' : 'absent' }
  }
}

const LABELERS_PREF = 'app.bsky.actor.defs#labelersPref'

type Pref = { $type?: string; labelers?: unknown } & Record<string, unknown>
type PrefsEdit = (all: Pref[]) => Pref[] | false

/**
 * The SDK's one prefs write (`updatePreferences`): it reads the prefs again
 * under the agent's prefs lock and puts back what `edit` returns; `false`
 * writes nothing. Protected in the SDK's types, so it is checked: an SDK
 * upgrade that moves it fails the tests instead of writing some other way.
 */
function prefsWriter(agent: Agent): (edit: PrefsEdit) => Promise<unknown> {
  const fn = (agent as unknown as { updatePreferences?: (edit: PrefsEdit) => Promise<unknown> }).updatePreferences
  if (typeof fn !== 'function') throw new Error('Bluesky SDK: no prefs write')
  return fn.bind(agent)
}

// The SDK internals sign-out needs (README: "Sign-out"). Protected in the
// SDK's types; a missing one throws, so an SDK upgrade that moves them fails
// the tests instead of leaving tokens behind.
interface StoredSession {
  dpopKey: unknown
  authMethod: unknown
  tokenSet: { iss: string; access_token: string; refresh_token?: string }
}
interface SessionGetterLike {
  getStored(sub: string): Promise<StoredSession | undefined>
  setStored(sub: string, session: StoredSession): Promise<void>
  delStored(sub: string, cause?: unknown): Promise<void>
}
interface SdkInternals {
  sessionGetter: SessionGetterLike
  serverFactory: {
    fromIssuer(iss: string, authMethod: unknown, dpopKey: unknown): Promise<{ revoke(token: string): Promise<void> }>
  }
}

function internals(oauth: object): SdkInternals {
  const o = oauth as Partial<SdkInternals>
  const g = o.sessionGetter
  if (typeof g?.getStored !== 'function' || typeof g.setStored !== 'function' || typeof g.delStored !== 'function') {
    throw new Error('Bluesky SDK: no session store to delete from')
  }
  if (typeof o.serverFactory?.fromIssuer !== 'function') throw new Error('Bluesky SDK: no server factory')
  return o as SdkInternals
}

// The DIDs signing out on this page. Their writes are refused (README:
// "Sign-out", the one rule).
const signingOut = new Set<string>()
const guarded = new WeakSet<object>()

/** Revokes a session's tokens at its server; best effort, never waited for. */
function revokeAtServer(sdk: SdkInternals, session: StoredSession): void {
  const { tokenSet } = session
  void sdk.serverFactory.fromIssuer(tokenSet.iss, session.authMethod, session.dpopKey)
    .then((server) => server.revoke(tokenSet.refresh_token ?? tokenSet.access_token))
    .catch(() => {})
}

/**
 * Wraps the SDK's one write path for sessions (`sessionGetter.setStored`):
 * a write for a DID that is signing out is dropped, anything stored for it
 * is deleted, and the dropped tokens are revoked at the server, best effort.
 * Idempotent.
 */
export function guardSessionStore(oauth: object): void {
  const sdk = internals(oauth)
  const getter = sdk.sessionGetter
  if (guarded.has(getter)) return
  guarded.add(getter)
  const write = getter.setStored.bind(getter)
  getter.setStored = async (sub, session) => {
    if (!signingOut.has(sub)) return write(sub, session)
    revokeAtServer(sdk, session)
    await getter.delStored(sub)
  }
}

/** A new sign-in for `did` starts: its writes are allowed again. */
export function allowSessionWrites(did: string): void {
  signingOut.delete(did)
}

/**
 * Signs out of `did` (README: "Sign-out"): refuses every later write for it,
 * deletes the stored tokens and DPoP key, then starts the server revoke and
 * does not wait for it. Throws only when the local delete failed.
 */
export async function signOut(oauth: Pick<OAuthLike, 'revoke'>, did: string): Promise<void> {
  guardSessionStore(oauth)
  const sdk = internals(oauth)
  signingOut.add(did)
  const stored = await sdk.sessionGetter.getStored(did)
  if (!stored) return
  await sdk.sessionGetter.delStored(did, new TokenRevokedError(did))
  revokeAtServer(sdk, stored)
}
