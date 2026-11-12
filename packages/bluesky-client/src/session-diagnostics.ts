// Server safe and SDK free: Settings can read this without loading atproto.
export const SESSION_END_KEY = 'caribou.bluesky.session-ends'
export const SESSION_END_EVENT = 'caribou:bluesky-session-end'
const REASONS = ['deleted', 'restore', 'sign-out'] as const
type Reason = typeof REASONS[number]
const CLASSES = ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'TokenRefreshError', 'TokenRevokedError', 'TokenInvalidError', 'AuthMethodUnsatisfiableError', 'OAuthResponseError', 'AggregateError'] as const
const MESSAGES = [
  'Signed out', 'Refresh token was refused (invalid_grant)', 'No stored session',
  'No refresh token available', 'Stored session sub mismatch', 'Token set sub mismatch',
  'Token was revoked', 'Refreshed token was rejected', 'Client authentication is no longer supported',
  'Session deleted; error details redacted',
] as const

export interface SessionEnd {
  time: string
  session?: string
  reason: Reason
  errorClass: string
  message: string
  status: number | null
  online: boolean | null
  visibility: 'visible' | 'hidden' | 'unknown'
}

function errorChain(cause: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (let n = 0; n < 5 && cause && typeof cause === 'object'; n++) {
    const item = cause as Record<string, unknown>
    out.push(item)
    cause = item.cause
  }
  return out
}

function safeClass(item: Record<string, unknown> | undefined): string {
  const ctor = item?.constructor as { name?: string } | undefined
  const name = ctor?.name !== 'Object' && ctor?.name !== 'Error' ? ctor?.name : item?.name
  return CLASSES.includes(name as typeof CLASSES[number]) ? String(name) : 'Error'
}

/** Fixed vocabulary only: server messages can contain tokens and identities. */
function safeMessage(reason: Reason, chain: Record<string, unknown>[], errorClass: string): string {
  if (reason === 'sign-out') return 'Signed out'
  if (chain.some((e) => e.error === 'invalid_grant')) return 'Refresh token was refused (invalid_grant)'
  const first = chain[0]
  if (first?.message === 'The session was deleted by another process') return 'No stored session'
  for (const message of ['No refresh token available', 'Stored session sub mismatch', 'Token set sub mismatch']) {
    if (errorClass === 'TokenRefreshError' && first?.message === message) return message
  }
  if (errorClass === 'TokenRevokedError') return 'Token was revoked'
  if (errorClass === 'TokenInvalidError') return 'Refreshed token was rejected'
  if (errorClass === 'AuthMethodUnsatisfiableError') return 'Client authentication is no longer supported'
  return 'Session deleted; error details redacted'
}

function statusOf(chain: Record<string, unknown>[]): number | null {
  return chain.map((e) => e.status).find((s): s is number =>
    typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599) ?? null
}

function valid(row: unknown): row is SessionEnd {
  if (!row || typeof row !== 'object') return false
  const r = row as SessionEnd
  return typeof r.time === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.time)
    && (r.session === undefined || typeof r.session === 'string' && /^[a-f0-9]{8}$/.test(r.session))
    && REASONS.includes(r.reason) && CLASSES.includes(r.errorClass as typeof CLASSES[number])
    && MESSAGES.includes(r.message as typeof MESSAGES[number])
    && (r.status === null || Number.isInteger(r.status) && r.status >= 100 && r.status <= 599)
    && (r.online === null || typeof r.online === 'boolean')
    && ['visible', 'hidden', 'unknown'].includes(r.visibility)
}

/** Storage is untrusted; project validated fields so extra fields never escape. */
export function readSessionEnds(): SessionEnd[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(SESSION_END_KEY) ?? '[]')
    if (!Array.isArray(data)) return []
    return data.filter(valid).slice(-20).map(({ time, session, reason, errorClass, message, status, online, visibility }) =>
      ({ time, session, reason, errorClass, message, status, online, visibility }))
  } catch { return [] }
}

// A short correlation hash, never the subject or the sign-in key itself.
function sessionHash(key: string): string {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Best effort, local only. Never serialize errors or their causes. */
export function recordSessionEnd(reason: Reason, cause?: unknown, opts: { key?: string; errorClass?: typeof CLASSES[number] } = {}): void {
  try {
    const chain = errorChain(cause)
    const errorClass = opts.errorClass && CLASSES.includes(opts.errorClass) ? opts.errorClass : safeClass(chain[0])
    const message = safeMessage(reason, chain, errorClass)
    const session = opts.key ? sessionHash(opts.key) : undefined
    const status = statusOf(chain)
    const entries = readSessionEnds()
    // Reopening Settings restores the already-ended sign-in. Keep its real
    // cause rather than overwriting it with the resulting empty store.
    if (session && entries.some((e) => e.session === session && (
      message === 'No stored session' || message === 'Session deleted; error details redacted'
      || e.message === message && e.errorClass === errorClass && e.status === status
    ))) return
    const visibility = typeof document === 'undefined' ? 'unknown' : document.visibilityState
    const entry: SessionEnd = {
      time: new Date().toISOString(), session, reason, errorClass, message, status,
      online: typeof globalThis.navigator?.onLine === 'boolean' ? navigator.onLine : null,
      visibility: visibility === 'visible' || visibility === 'hidden' ? visibility : 'unknown',
    }
    localStorage.setItem(SESSION_END_KEY, JSON.stringify([...entries, entry].slice(-20)))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_END_EVENT))
  } catch { /* Diagnostics must never change session handling. */ }
}
