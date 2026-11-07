// The app's side of a Bluesky session: the driver `packages/state` restores
// through, the sign-in start, and the callback's finish. The rules are in
// `packages/state/README.md` ("Bluesky sessions") and
// `packages/bluesky-client/README.md` ("Sign-in and sessions").
//
// Every atproto call goes through `loadBluesky()`, so the libraries stay in
// their lazy chunk (`_bluesky.ts`).

import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { BLUESKY_CAPABILITIES } from '@beatzball/caribou-bluesky-client'
import type { BlueskyReader } from '@beatzball/caribou-bluesky-client/moderation'
import {
  activeUserKey, addUserSession, blueskyUserKey, setBlueskyDriver, BlueskySessionGone,
  type BlueskyDriver,
} from '@beatzball/caribou-state'
import { blueskyOAuthConfig, loadBluesky, type BlueskyBrowser } from './_bluesky.js'

/**
 * The active Bluesky reader's moderation inputs, for the reader veil and the
 * cards (#184). Null until the active Bluesky client has restored, and while
 * a Mastodon account is active. `prefs` or `labelDefs` null: failed to load.
 */
export const blueskyReader = signal<BlueskyReader | null>(null)

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
        onExpired: hooks.onExpired,
      })
      if (activeUserKey.peek() === session.userKey) {
        blueskyReader.value = {
          userKey: session.userKey as BlueskyReader['userKey'],
          prefs: restored.prefs,
          labelDefs: restored.labelDefs,
        }
      }
      return restored.client
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

/** Sets the driver. The app entry calls it once, before any client is made. */
export function installBlueskyDriver(): void {
  setBlueskyDriver(blueskyDriver)
  // The reader belongs to one account.
  activeUserKey.subscribe((key) => {
    if (blueskyReader.peek() && blueskyReader.peek()!.userKey !== key) blueskyReader.value = null
  })
}

/** Why a sign-in did not start or did not finish, in words for the reader. */
export function signInErrorMessage(err: unknown, mod?: BlueskyBrowser): string {
  if (mod && err instanceof mod.StorageUnavailable) {
    return 'Bluesky sign-in needs site storage. Allow site data for Caribou, or leave private browsing, and try again.'
  }
  if (mod && err instanceof mod.InvalidSignInInput) return 'Enter a Bluesky handle, a DID or a server address.'
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
    // per origin: a sign-in started on `localhost` could not finish.
    if (location.hostname === 'localhost') {
      throw new LoopbackHostError(`Open Caribou at http://127.0.0.1${location.port ? `:${location.port}` : ''} to sign in to Bluesky.`)
    }
    mod = await load()
    const oauth = await oauthClient(mod)
    await mod.beginSignIn(oauth, input, { handleResolver: blueskyOAuthConfig(location.origin).handleResolver })
    return await new Promise<never>(() => {})
  } catch (err) {
    return signInErrorMessage(err, mod)
  }
}

/**
 * The callback page's work (spec 5.5, steps 4 to 6): finish the sign-in once,
 * store the session, and answer the user key. Throws the reader-facing
 * message when it failed; nothing is stored then.
 */
export async function finishBlueskySignIn(): Promise<UserKey> {
  let mod: BlueskyBrowser | undefined
  try {
    mod = await load()
    const done = await mod.completeSignIn(await oauthClient(mod))
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
    throw new Error(signInErrorMessage(err, mod), { cause: err })
  }
}
