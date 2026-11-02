import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { activeUserKey } from '@beatzball/caribou-state'
import {
  changelogUnread, compareVersions, markChangelogSeen, startChangelogSeen,
} from '../_changelog-seen.js'

const ALICE = 'alice@example.social'
const BOB = 'bob@example.social'
const prefs = (key: string) => JSON.parse(localStorage.getItem(`caribou.prefs.${key}`) ?? 'null') as Record<string, unknown> | null

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.9.9', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })

  it('puts a prerelease before its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0-alpha.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBeLessThan(0)
  })
})

describe('changelog seen marker', () => {
  let stop: () => void = () => {}

  beforeEach(() => {
    localStorage.clear()
    activeUserKey.value = null
  })

  afterEach(() => {
    stop()
    activeUserKey.value = null
    localStorage.clear()
  })

  it('shows no dot when signed out', () => {
    stop = startChangelogSeen('0.11.0')
    expect(changelogUnread.value).toBe(false)
  })

  it('takes the running version as seen the first time, with no dot', () => {
    activeUserKey.value = ALICE
    stop = startChangelogSeen('0.11.0')
    expect(changelogUnread.value).toBe(false)
    expect(prefs(ALICE)).toEqual({ lastSeenChangelogVersion: '0.11.0' })
  })

  it('keeps the other prefs when it writes', () => {
    localStorage.setItem(`caribou.prefs.${ALICE}`, JSON.stringify({ lastSeenNotificationId: '9' }))
    activeUserKey.value = ALICE
    stop = startChangelogSeen('0.11.0')
    expect(prefs(ALICE)).toEqual({ lastSeenNotificationId: '9', lastSeenChangelogVersion: '0.11.0' })
  })

  it('shows the dot when a newer version runs, and clears it on mark', () => {
    localStorage.setItem(`caribou.prefs.${ALICE}`, JSON.stringify({ lastSeenChangelogVersion: '0.10.2' }))
    activeUserKey.value = ALICE
    stop = startChangelogSeen('0.11.0')
    expect(changelogUnread.value).toBe(true)
    markChangelogSeen()
    expect(changelogUnread.value).toBe(false)
    expect(prefs(ALICE)!.lastSeenChangelogVersion).toBe('0.11.0')
  })

  it('shows no dot when the running version is older than the one seen', () => {
    localStorage.setItem(`caribou.prefs.${ALICE}`, JSON.stringify({ lastSeenChangelogVersion: '0.12.0' }))
    activeUserKey.value = ALICE
    stop = startChangelogSeen('0.11.0')
    expect(changelogUnread.value).toBe(false)
    markChangelogSeen()
    expect(prefs(ALICE)!.lastSeenChangelogVersion).toBe('0.12.0')
  })

  it('follows the active account', () => {
    localStorage.setItem(`caribou.prefs.${ALICE}`, JSON.stringify({ lastSeenChangelogVersion: '0.11.0' }))
    localStorage.setItem(`caribou.prefs.${BOB}`, JSON.stringify({ lastSeenChangelogVersion: '0.10.0' }))
    activeUserKey.value = ALICE
    stop = startChangelogSeen('0.11.0')
    expect(changelogUnread.value).toBe(false)
    activeUserKey.value = BOB
    expect(changelogUnread.value).toBe(true)
  })

  it('mark does nothing when signed out', () => {
    stop = startChangelogSeen('0.11.0')
    markChangelogSeen()
    expect(localStorage.length).toBe(0)
  })

  it('treats broken prefs as empty', () => {
    localStorage.setItem(`caribou.prefs.${ALICE}`, '{not json')
    activeUserKey.value = ALICE
    stop = startChangelogSeen('0.11.0')
    expect(changelogUnread.value).toBe(false)
    expect(prefs(ALICE)).toEqual({ lastSeenChangelogVersion: '0.11.0' })
  })
})
