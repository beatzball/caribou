import { signal } from '@preact/signals-core'
import type { UserKey } from '@beatzball/caribou-auth'
import {
  CaribouError,
  type CaribouClient, type Capabilities, type TimelineKind, type TimelineOrder,
} from '@beatzball/caribou-mastodon-client'
import type { BlueskySession, UserSession } from './users.js'

// The rules for a Bluesky session are in this package's README ("Bluesky
// sessions", rules 8 to 12). The numbers in the comments below name them.

/** The user key of a Bluesky account: `<did>@bsky`. A DID has no `@`. */
export function blueskyUserKey(did: string): UserKey {
  return `${did}@bsky` as UserKey
}

export function isBlueskySession(s: Pick<UserSession, 'userKey'> & { network?: string }): s is BlueskySession {
  return s.network === 'bluesky'
}

/**
 * What the driver throws when the SDK says the session is gone: a refresh
 * refused, a token revoked or invalid, or no stored session for the DID.
 * Anything else it throws is a failure of one request (rule 5).
 */
export class BlueskySessionGone extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BlueskySessionGone'
  }
}

export interface BlueskyRestoreHooks {
  /**
   * The SDK said later that the session is gone (its `deleted` event, a
   * refresh refused mid-session). Sends `caribou:session-expired` with the
   * client's own sign-in.
   */
  onExpired(): void
}

/**
 * The app's side of a Bluesky session (rule 10). It is the only code that
 * loads the atproto libraries, through a dynamic `import()`.
 */
export interface BlueskyDriver {
  readonly capabilities: Readonly<Capabilities>
  timelineOrder(kind: TimelineKind): TimelineOrder
  /**
   * Restores the OAuth session for `session.did` and builds its client.
   * Throws `BlueskySessionGone` when the session is gone.
   */
  restore(session: BlueskySession, hooks: BlueskyRestoreHooks): Promise<CaribouClient>
  /** Revokes the session at the PDS and deletes its stored tokens. */
  signOut(did: string): Promise<void>
}

let driver: BlueskyDriver | null = null

/** Sets the driver the Bluesky clients use. `null` removes it (tests). Forgets every restore. */
export function setBlueskyDriver(d: BlueskyDriver | null): void {
  driver = d
  restores.clear()
}

// Rule 9: one restore per sign-in, kept by `userKey` and `generation`.
interface Restore {
  ready: Promise<CaribouClient> | null
  gone: boolean
}
const restores = new Map<string, Restore>()

export function blueskyDriver(): BlueskyDriver | null {
  return driver
}

/** The active Bluesky client's restore (rule 8). Screens show the splash while `'pending'`. */
export const blueskyRestore = signal<'idle' | 'pending' | 'ready' | 'failed'>('idle')

// The methods that answer at once. Every other member is an async method.
const SYNC = new Set<PropertyKey>(['userKey', 'capabilities', 'timelineOrder'])

/**
 * A client for one Bluesky sign-in (rules 8 and 9). It answers at once and
 * runs every async method on the restored client. `emitExpired` sends
 * `caribou:session-expired` for this session's own `generation`.
 */
export function deferredBlueskyClient(session: BlueskySession, emitExpired: () => void): CaribouClient {
  const d = driver
  const id = `${session.userKey} ${session.generation}`
  let r = restores.get(id)
  if (!r) {
    r = { ready: null, gone: false }
    restores.set(id, r)
  }
  const restore = r
  const hooks: BlueskyRestoreHooks = {
    onExpired: () => {
      if (restore.gone) return
      restore.gone = true
      emitExpired()
    },
  }
  const unauthorized = () => new CaribouError('unauthorized', 'Bluesky session ended')

  function client(): Promise<CaribouClient> {
    if (!d) return Promise.reject(new CaribouError('unauthorized', 'Bluesky is not available'))
    if (restore.gone) return Promise.reject(unauthorized())
    if (!restore.ready) {
      blueskyRestore.value = 'pending'
      const run = d.restore(session, hooks).then(
        (c) => {
          blueskyRestore.value = 'ready'
          return c
        },
        (err: unknown) => {
          blueskyRestore.value = 'failed'
          if (err instanceof BlueskySessionGone) {
            hooks.onExpired()
            throw unauthorized()
          }
          // Rule 9: a failed restore that is not "gone" is tried again.
          restore.ready = null
          throw err
        },
      )
      restore.ready = run
    }
    return restore.ready
  }

  const base = {
    userKey: session.userKey,
    capabilities: d?.capabilities ?? NO_DRIVER_CAPABILITIES,
    timelineOrder: (kind: TimelineKind) => d ? d.timelineOrder(kind) : null,
  }
  return new Proxy(base, {
    get(target, prop) {
      if (SYNC.has(prop)) return target[prop as keyof typeof target]
      // Not a thenable: `await client` must give the client.
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      return (...args: unknown[]) => client().then((c) => {
        if (restore.gone) throw unauthorized()
        const fn = (c as unknown as Record<string, unknown>)[prop]
        if (typeof fn !== 'function') throw new TypeError(`Bluesky client has no method ${prop}`)
        return (fn as (...a: unknown[]) => unknown).apply(c, args)
      })
    },
  }) as unknown as CaribouClient
}

// Only seen with no driver set, where every call fails anyway.
const NO_DRIVER_CAPABILITIES = Object.freeze({
  network: 'bluesky',
  localTimeline: false,
  publicTimeline: false,
  visibility: false,
  contentWarningText: false,
  polls: false,
  edit: false,
  customEmoji: false,
  followTags: false,
  privateLists: false,
  serverFilters: false,
  maxChars: 300,
  maxBytes: 3000,
  maxImages: 4,
  maxImageBytes: 2_000_000,
  readLagMs: 60_000,
}) as Readonly<Capabilities>
