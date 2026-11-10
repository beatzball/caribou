// The app's side of a Bluesky session: the driver `packages/state` restores
// through, the sign-in start, and the callback's finish. The rules are in
// `packages/state/README.md` ("Bluesky sessions") and
// `packages/bluesky-client/README.md` ("Sign-in and sessions").
//
// Every atproto call goes through `loadBluesky()`, so the libraries stay in
// their lazy chunk (`_bluesky.ts`).

import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import { BLUESKY_CAPABILITIES } from '@beatzball/caribou-bluesky-client'
import {
  activeUserKey, addUserSession, blueskyUserKey, isBlueskySession, renewSession, setBlueskyDriver, users,
  BlueskySessionGone,
  type BlueskyDriver,
} from '@beatzball/caribou-state'
import { BLUESKY_CALLBACK_PATH, blueskyOAuthConfig, loadBluesky, type BlueskyBrowser } from './_bluesky.js'
import { BLUESKY_RETRY_EVENT, blueskyGoneLabelers, blueskyReader, setBlueskyReader } from './_bluesky-moderation.js'

// The active Bluesky reader's moderation inputs (prefs and label
// definitions) go to the one reader signal in `_bluesky-moderation.ts`,
// through `setBlueskyReader`. Null until the active Bluesky client has
// restored, and while a Mastodon account is active. `prefs` or `labelDefs`
// null: failed to load (fail closed).

type Restored = Awaited<ReturnType<BlueskyBrowser['restoreClient']>>

// The active account's restored session, for a cover's Retry
// (`BLUESKY_RETRY_EVENT`): its definitions load again, and the client's
// calls wait for that, so the card's refetch is judged with the new ones.
// `checkedAt`: when its definitions were last loaded or checked.
// `removing`: the gone-labeler removals in flight, by DID (one each).
let active: {
  userKey: string; restored: Restored; reloading: Promise<void> | null
  rechecking: Promise<void> | null; checkedAt: number
  removing?: Map<string, Promise<RemoveOutcome>>
} | null = null

/**
 * How often the active reader's label definitions are checked again while
 * the page is visible (bluesky-client README, "Labeler coverage"). A
 * labeler taken down since loses its definitions, so the veil covers again.
 */
export const LABELER_RECHECK_MS = 10 * 60_000
/** A return to the foreground checks again, unless a check ran this recently. */
export const FOREGROUND_RECHECK_MIN_MS = 60_000

function publishReader(userKey: string, r: { prefs: Restored['prefs']; labelDefs: Restored['labelDefs']; gone: readonly string[] }): void {
  setBlueskyReader({ userKey: userKey as `${string}@${string}`, prefs: r.prefs, labelDefs: r.labelDefs })
  blueskyGoneLabelers.value = { userKey, dids: r.gone ?? [] }
}

/** How a removal ended. `stale`: the account changed; nothing was shown. */
export type RemoveOutcome = 'removed' | 'back' | 'absent' | 'stale'

/**
 * Removes a gone labeler from the active reader's prefs (#238; bluesky
 * README, "A gone labeler"). The caller has asked the reader first. One
 * removal per DID at a time: a second call gets the first one's promise.
 * The answer is shown only while its account is still active. Throws on a
 * failed check or write; the reader then stays as it was.
 */
export function removeActiveGoneLabeler(did: string): Promise<RemoveOutcome> {
  const a = active
  if (!a || activeUserKey.peek() !== a.userKey) return Promise.resolve('stale')
  a.removing ??= new Map()
  const running = a.removing.get(did)
  if (running) return running
  const p = a.restored.removeGoneLabeler(did).then((r): RemoveOutcome => {
    if (active !== a || activeUserKey.peek() !== a.userKey) return 'stale'
    a.checkedAt = Date.now()
    publishReader(a.userKey, r)
    return r.outcome
  }).finally(() => { a.removing?.delete(did) })
  a.removing.set(did, p)
  return p
}

/** Loads the active reader's moderation inputs again. One at a time. */
export function reloadActiveModeration(): Promise<void> | null {
  const a = active
  if (!a || activeUserKey.peek() !== a.userKey) return null
  a.checkedAt = Date.now()
  a.reloading ??= a.restored.reloadModeration().then(
    (r) => { if (active === a && activeUserKey.peek() === a.userKey) publishReader(a.userKey, r) },
    // Still unknown: the covers stay, with Retry.
    () => {},
  ).finally(() => { a.reloading = null })
  return a.reloading
}

/**
 * Checks the active reader's label definitions again (`recheckLabelers`).
 * One at a time, and not while a full reload runs. A failed check changes
 * nothing.
 */
export function recheckActiveLabelers(): Promise<void> | null {
  const a = active
  if (!a || activeUserKey.peek() !== a.userKey) return null
  if (a.reloading) return a.reloading
  a.checkedAt = Date.now()
  a.rechecking ??= a.restored.recheckLabelers().then(
    (r) => { if (active === a && activeUserKey.peek() === a.userKey) publishReader(a.userKey, r) },
    () => {},
  ).finally(() => { a.rechecking = null })
  return a.rechecking
}

let stopRecheck: (() => void) | null = null

// Every LABELER_RECHECK_MS while visible, and on a return to the foreground.
function startLabelerRecheck(): void {
  stopRecheck?.()
  const visible = () => document.visibilityState === 'visible'
  const timer = setInterval(() => { if (visible()) void recheckActiveLabelers() }, LABELER_RECHECK_MS)
  const onVisibility = () => {
    if (visible() && active && Date.now() - active.checkedAt >= FOREGROUND_RECHECK_MIN_MS) void recheckActiveLabelers()
  }
  document.addEventListener('visibilitychange', onVisibility)
  stopRecheck = () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

// Every async call waits for a reload in progress for its account.
function afterReload(client: CaribouClient, userKey: string): CaribouClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function' || prop === 'timelineOrder') return value
      return (...args: unknown[]) => {
        const pending = active?.userKey === userKey ? active.reloading : null
        if (!pending) return (value as (...a: unknown[]) => unknown).apply(target, args)
        return pending.then(() => (value as (...a: unknown[]) => unknown).apply(target, args))
      }
    },
  })
}

async function oauthClient(mod: BlueskyBrowser) {
  return mod.loadOAuthClient(blueskyOAuthConfig(location.origin))
}

// The chunk itself failed to load: a network failure like any other.
async function load(): Promise<BlueskyBrowser> {
  try {
    return await loadBluesky()
  } catch {
    throw new CaribouError('unreachable', 'Could not load Bluesky')
  }
}

export const blueskyDriver: BlueskyDriver = {
  capabilities: BLUESKY_CAPABILITIES,
  timelineOrder: () => null,

  async restore(session, hooks) {
    const mod = await load()
    try {
      const oauth = await oauthClient(mod)
      const restored = await mod.restoreClient(oauth, session.did, {
        userKey: session.userKey,
        // One deleted listener per sign-in (state rule 9).
        key: session.generation,
        onExpired: hooks.onExpired,
      })
      if (activeUserKey.peek() === session.userKey) {
        active = { userKey: session.userKey, restored, reloading: null, rechecking: null, checkedAt: Date.now() }
        publishReader(session.userKey, restored)
      }
      return afterReload(restored.client, session.userKey)
    } catch (err) {
      if (err instanceof mod.SessionGone) throw new BlueskySessionGone(err.message, { cause: err })
      throw mod.normalizeXrpcError(err)
    }
  },

  async signOut(did) {
    const mod = await load()
    await mod.signOut(await oauthClient(mod), did)
  },
}

/**
 * Whether the page loads the active account (`loadActiveAccount`). Not on
 * the callback page: it leaves for `/home` at once, which loads it.
 */
export function loadsAccountOn(pathname: string): boolean {
  return pathname !== BLUESKY_CALLBACK_PATH
}

/** Sets the driver. The app entry calls it once, before any client is made. */
export function installBlueskyDriver(): void {
  setBlueskyDriver(blueskyDriver)
  // The reader belongs to one account.
  activeUserKey.subscribe((key) => {
    if (blueskyReader.peek() && blueskyReader.peek()!.userKey !== key) setBlueskyReader(null)
    if (blueskyGoneLabelers.peek() && blueskyGoneLabelers.peek()!.userKey !== key) blueskyGoneLabelers.value = null
    if (active && active.userKey !== key) active = null
  })
  // A cover's Retry (#184): load the definitions again.
  window.addEventListener(BLUESKY_RETRY_EVENT, () => { void reloadActiveModeration() })
  // A labeler taken down since its definitions loaded (#233).
  startLabelerRecheck()
}

/** Why a sign-in did not start or did not finish, in words for the reader. */
export function signInErrorMessage(err: unknown, mod?: BlueskyBrowser): string {
  if (mod && err instanceof mod.StorageUnavailable) {
    return 'Bluesky sign-in needs site storage. Allow site data for Caribou, or leave private browsing, and try again.'
  }
  if (mod && err instanceof mod.InvalidSignInInput) return 'Enter a Bluesky handle, a DID or a server address.'
  if (mod && err instanceof mod.SignInCancelled) return 'Sign-in was cancelled.'
  if (mod && err instanceof mod.NoCallbackParams) {
    return 'This sign-in link was already used or has expired. Start again.'
  }
  if (mod && err instanceof mod.SignInRejected && err.kept) {
    return 'You approved an account you already use here, not the one you entered. Nothing was added. Try again.'
  }
  if (mod && err instanceof mod.SignInMismatch) {
    return 'You signed in to another account than the one you entered. Nothing was saved. Try again.'
  }
  if (err instanceof LoopbackHostError) return err.message
  return 'Could not sign in to Bluesky. Check the handle and try again.'
}

class LoopbackHostError extends Error {}

/**
 * Starts a Bluesky sign-in for what the reader typed. Resolves only when it
 * failed (with the reader-facing message); on success the page navigates
 * to the authorization server.
 */
export async function startBlueskySignIn(input: string): Promise<string> {
  let mod: BlueskyBrowser | undefined
  try {
    // The loopback client's redirect goes to 127.0.0.1, and site storage is
    // per origin: a sign-in started on `localhost` or `[::1]` could not finish.
    if (location.hostname === 'localhost' || location.hostname === '[::1]') {
      throw new LoopbackHostError(`Open Caribou at http://127.0.0.1${location.port ? `:${location.port}` : ''} to sign in to Bluesky.`)
    }
    mod = await load()
    const oauth = await oauthClient(mod)
    await mod.beginSignIn(oauth, input, { handleResolver: blueskyOAuthConfig(location.origin).handleResolver })
    return await new Promise<never>(() => {})
  } catch (err) {
    console.warn('[caribou] Bluesky sign-in did not start', err)
    return signInErrorMessage(err, mod)
  }
}

/**
 * The callback page's work (spec 5.5, steps 4 to 6): finish the sign-in once,
 * store the session, and answer the user key. Throws the reader-facing
 * message when it failed; nothing is stored then.
 */
export function finishBlueskySignIn(): Promise<UserKey> {
  // Once per page load. The page can mount its element twice (hydration and
  // the router's first render), and the SDK's state is single-use: a second
  // run finds the fragment gone and fails, which is what the spike saw
  // (spec 12.2). Every caller gets the one result.
  finishing ??= finish()
  return finishing
}

let finishing: Promise<UserKey> | null = null

/** Tests only: forget the finished run. */
export function resetFinishForTests(): void {
  finishing = null
}

async function finish(): Promise<UserKey> {
  let mod: BlueskyBrowser | undefined
  try {
    mod = await load()
    const known = (did: string) => {
      const entry = users.peek().get(blueskyUserKey(did))
      return !!entry && isBlueskySession(entry)
    }
    let done
    try {
      done = await mod.completeSignIn(await oauthClient(mod), { isKnown: known })
    } catch (err) {
      // State rule 11: the account that signed in is already here; its new
      // session stays and its entry is renewed. Nothing is added.
      if (err instanceof mod.SignInRejected && err.kept) renewSession(blueskyUserKey(err.actual))
      throw err
    }
    const userKey = blueskyUserKey(done.did)
    addUserSession({
      network: 'bluesky',
      userKey,
      did: done.did,
      handle: done.handle,
      pds: done.pds,
      account: null,
      createdAt: Date.now(),
    })
    return userKey
  } catch (err) {
    console.warn('[caribou] Bluesky sign-in did not finish', err)
    throw new Error(signInErrorMessage(err, mod), { cause: err })
  }
}
