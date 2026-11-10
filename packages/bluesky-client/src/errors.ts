import { CaribouError } from '@beatzball/caribou-mastodon-client'

/**
 * The shape of the SDK's `XRPCError`, read by duck typing so this module
 * needs no runtime import of the SDK. `status` 1 is the SDK's "no answer".
 */
interface XrpcErrorLike {
  status: number
  error?: string
  message: string
  headers?: Record<string, string>
}

function isXrpcErrorLike(e: unknown): e is XrpcErrorLike {
  return e instanceof Error && typeof (e as { status?: unknown }).status === 'number'
}

// The AppView answers a missing post, profile or thread with 400 and an
// error name or message, not 404.
const NOT_FOUND_ERRORS = new Set(['NotFound', 'ProfileNotFound', 'AccountTakedown', 'AccountDeactivated'])

function retryAfterSeconds(headers: Record<string, string> | undefined): number | undefined {
  const reset = headers?.['ratelimit-reset']
  if (reset !== undefined) {
    const at = Number.parseInt(reset, 10)
    if (Number.isFinite(at)) return Math.max(0, at - Math.floor(Date.now() / 1000))
  }
  const after = headers?.['retry-after']
  const n = after === undefined ? Number.NaN : Number.parseInt(after, 10)
  return Number.isFinite(n) ? n : undefined
}

/** Any error from an XRPC call → a `CaribouError` (rules in the README). */
export function normalizeXrpcError(err: unknown): CaribouError {
  if (err instanceof CaribouError) return err
  if (isXrpcErrorLike(err)) {
    const { status, message } = err
    const opts = { status }
    if (status === 1) return new CaribouError('unreachable', message)
    if (status === 401) return new CaribouError('unauthorized', message, opts)
    if (status === 404 || (status === 400 && (NOT_FOUND_ERRORS.has(err.error ?? '') || /not found/i.test(message)))) {
      return new CaribouError('not_found', message, opts)
    }
    if (status === 429) {
      const retryAfter = retryAfterSeconds(err.headers)
      return new CaribouError('rate_limited', message, { status, ...(retryAfter !== undefined ? { retryAfter } : {}) })
    }
    if (status >= 500) return new CaribouError('server_error', message, opts)
    return new CaribouError('unknown', message, opts)
  }
  if (err instanceof TypeError && /fetch failed|network|Failed to fetch/i.test(err.message)) {
    return new CaribouError('unreachable', err.message)
  }
  return new CaribouError('unknown', err instanceof Error ? err.message : String(err))
}

/**
 * The PDS does not have a blob the post names (spec 7.2): it may drop an
 * upload no record used for a while. `cid` is the missing blob, when the
 * message names it. Compose uploads the file again, or asks for it.
 */
export class BlueskyBlobNotFound extends CaribouError {
  readonly cid: string | null
  constructor(message: string, cid: string | null) {
    super('not_found', message, { status: 400 })
    this.name = 'BlueskyBlobNotFound'
    this.cid = cid
  }
}

/**
 * A delete whose outcome is not known (README, "Delete"): the delete got no
 * clear answer, and reading the record failed too. The record may be gone
 * or still there; a caller must not say "not deleted".
 */
export class BlueskyDeleteUnknown extends CaribouError {
  constructor(message: string) {
    super('unknown', message)
    this.name = 'BlueskyDeleteUnknown'
  }
}

/**
 * A list write whose outcome is not known (README, "Lists"): the write got
 * no clear answer, and the read that decides it failed too. The change may
 * be saved or not; a caller must not say either.
 */
export class BlueskyWriteUnknown extends CaribouError {
  constructor(message: string) {
    super('unknown', message)
    this.name = 'BlueskyWriteUnknown'
  }
}

/**
 * A list delete that removed some of its items but not the list record
 * (README, "Lists", L2). The list is still there, with fewer members.
 * Delete it again to finish.
 */
export class BlueskyListPartlyDeleted extends CaribouError {
  readonly userMessage = 'Some members were removed, but the list was not deleted. Delete it again to finish.'
  constructor(message: string) {
    super('unknown', message)
    this.name = 'BlueskyListPartlyDeleted'
  }
}
