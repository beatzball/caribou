import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { activeUserKey, addUserSession, users, type UserSession } from '@beatzball/caribou-state'
import { installUnauthorizedHandler } from '../_unauthorized.js'

const bob = toUserKey('bob', 'example.social')
const alice = toUserKey('alice', 'example.social')

function session(userKey: typeof bob, token: string): UserSession {
  return {
    userKey, server: 'example.social', token, vapidKey: 'VAPID', account: null, createdAt: 1,
  }
}

function fire(target: EventTarget, userKey: string, token: string): void {
  target.dispatchEvent(new CustomEvent('caribou:unauthorized', { detail: { userKey, token } }))
}

describe('installUnauthorizedHandler', () => {
  let target: EventTarget
  let redirect: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    users.value = new Map()
    activeUserKey.value = null
    localStorage.clear()
    sessionStorage.clear()
    target = new EventTarget()
    redirect = vi.fn<() => void>()
    installUnauthorizedHandler(target, redirect)
  })

  it('signs out and redirects with the banner when the active session gets a 401', () => {
    addUserSession(session(bob, 'B1'))
    fire(target, bob, 'B1')
    expect(users.value.size).toBe(0)
    expect(sessionStorage.getItem('caribou.error')).toBe('unauthorized')
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('redirects once when two timelines get a 401 at the same time', () => {
    addUserSession(session(bob, 'B1'))
    fire(target, bob, 'B1')
    fire(target, bob, 'B1')
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('does not start a second redirect for a session made active after the first began', () => {
    addUserSession(session(bob, 'B1'))
    fire(target, bob, 'B1')
    addUserSession(session(alice, 'A1'))
    fire(target, alice, 'A1')
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('removes only the other session, silently, when a non-active session gets a 401', () => {
    addUserSession(session(alice, 'A1'))
    addUserSession(session(bob, 'B1'))
    fire(target, alice, 'A1')
    expect([...users.value.keys()]).toEqual([bob])
    expect(activeUserKey.value).toBe(bob)
    expect(sessionStorage.getItem('caribou.error')).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('ignores a 401 for a replaced session', () => {
    addUserSession(session(bob, 'B2'))
    fire(target, bob, 'B1')
    expect(users.value.get(bob)?.token).toBe('B2')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('still handles a real 401 after it ignored a stale one', () => {
    addUserSession(session(bob, 'B2'))
    fire(target, bob, 'B1')
    fire(target, bob, 'B2')
    expect(users.value.size).toBe(0)
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('ignores an event without a session', () => {
    addUserSession(session(bob, 'B1'))
    target.dispatchEvent(new Event('caribou:unauthorized'))
    expect(users.value.size).toBe(1)
    expect(redirect).not.toHaveBeenCalled()
  })
})
