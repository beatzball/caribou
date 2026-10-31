import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { resolveOrigin } from './public-origin.js'
import { STATE_TTL_MS } from './storage.js'

// Binds an OAuth sign-in to the browser that started it (login CSRF).
//
// `/api/signin/start` gives the browser a random nonce in a cookie and keeps
// only its hash in the state entry. The callback must bring the same nonce
// back. Without it, someone could start a sign-in to their own account and
// send the callback URL (`code` + `state`) to another reader, whose browser
// would then store and activate the stranger's account.
//
// `SameSite=Lax`: the callback is a top-level GET from the user's server, and
// Lax cookies go with it. The path keeps the cookie off every other request.
// `Secure` only when this site is on https: Safari (and every browser on a
// non-localhost http host) drops a Secure cookie that an http page sets, and
// sign-in must still work in development there.

export const SIGNIN_COOKIE = 'caribou.signin'
const COOKIE_PATH = '/api/signin'

export function newNonce(): string {
  return randomBytes(32).toString('base64url')
}

export function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

/** Whether `nonce` is the one whose hash the state entry keeps. Constant time. */
export function nonceMatches(nonce: string | undefined, hash: string | undefined): boolean {
  if (!nonce || !hash) return false
  const a = Buffer.from(hashNonce(nonce), 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function setSigninCookie(event: H3Event, nonce: string): void {
  setCookie(event, SIGNIN_COOKIE, nonce, {
    httpOnly: true, sameSite: 'lax', path: COOKIE_PATH,
    secure: resolveOrigin(event).startsWith('https:'),
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  })
}

export function readSigninCookie(event: H3Event): string | undefined {
  return getCookie(event, SIGNIN_COOKIE) || undefined
}

export function clearSigninCookie(event: H3Event): void {
  deleteCookie(event, SIGNIN_COOKIE, {
    httpOnly: true, sameSite: 'lax', path: COOKIE_PATH,
    secure: resolveOrigin(event).startsWith('https:'),
  })
}
