import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import { activeUserKey, addUserSession, switchAccount, users, type UserSession } from '@beatzball/caribou-state'
import type { LandRequest } from '../_switch-account.js'
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
  let redirect: ReturnType<typeof vi.fn<(req: LandRequest) => void>>

  beforeEach(() => {
    users.value = new Map()
    activeUserKey.value = null
    localStorage.clear()
    sessionStorage.clear()
    target = new EventTarget()
    redirect = vi.fn<(req: LandRequest) => void>()
    installUnauthorizedHandler(target, redirect)
  })

  it('signs out and asks for a landing with the banner when the active session gets a 401', () => {
    addUserSession(session(bob, 'B1'))
    fire(target, bob, 'B1')
    expect(users.value.size).toBe(0)
    expect(activeUserKey.value).toBeNull()
    expect(redirect).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith({ from: 'example.social', expired: true })
  })

  it('lands as the next stored account when the active one gets a 401', () => {
    const carol = toUserKey('carol', 'example.social')
    addUserSession(session(alice, 'A1'))
    addUserSession(session(carol, 'C1'))
    addUserSession(session(bob, 'B1'))
    switchAccount(alice)
    fire(target, alice, 'A1')
    // Next in the list after alice, as sign-out would pick.
    expect([...users.value.keys()]).toEqual([carol, bob])
    expect(activeUserKey.value).toBe(carol)
    expect(JSON.parse(localStorage.getItem('caribou.activeUserKey')!)).toBe(carol)
    expect(redirect).toHaveBeenCalledOnce()
    // No "signed out" banner: the reader is still signed in.
    expect(redirect).toHaveBeenCalledWith({ from: 'example.social', expired: false })
  })

  it('still checks the token before it moves to the next account', () => {
    addUserSession(session(alice, 'A1'))
    addUserSession(session(bob, 'B2'))
    fire(target, bob, 'B1')
    expect([...users.value.keys()]).toEqual([alice, bob])
    expect(activeUserKey.value).toBe(bob)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('asks once when two timelines get a 401 for the same session', () => {
    addUserSession(session(bob, 'B1'))
    fire(target, bob, 'B1')
    fire(target, bob, 'B1')
    expect(redirect).toHaveBeenCalledOnce()
  })

  it('still picks the next account for a second active 401 (the landing joins them)', () => {
    const carol = toUserKey('carol', 'example.social')
    addUserSession(session(alice, 'A1'))
    addUserSession(session(bob, 'B1'))
    addUserSession(session(carol, 'C1'))
    switchAccount(alice)
    fire(target, alice, 'A1')
    expect(activeUserKey.value).toBe(bob)
    fire(target, bob, 'B1')
    expect(activeUserKey.value).toBe(carol)
    expect(redirect).toHaveBeenCalledTimes(2)
    expect(redirect).toHaveBeenLastCalledWith({ from: 'example.social', expired: false })
  })

  it('removes only the other session, silently, when a non-active session gets a 401', () => {
    addUserSession(session(alice, 'A1'))
    addUserSession(session(bob, 'B1'))
    fire(target, alice, 'A1')
    expect([...users.value.keys()]).toEqual([bob])
    expect(activeUserKey.value).toBe(bob)
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
