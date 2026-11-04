import { afterEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  defaultTimelineOf, readPrefs, shortcutsOf, storageWorks, themeOf, updatePrefs,
} from '../prefs.js'

const key = toUserKey('alice', 'example.social')
const storageKey = `caribou.prefs.${key}`

afterEach(() => { localStorage.clear() })

describe('readPrefs', () => {
  it('is empty with nothing stored', () => {
    expect(readPrefs(key)).toEqual({})
  })

  it('is empty for broken JSON or a value that is not an object', () => {
    for (const raw of ['{', '[]', '"x"', '3', 'null']) {
      localStorage.setItem(storageKey, raw)
      expect(readPrefs(key)).toEqual({})
    }
  })
})

describe('updatePrefs', () => {
  it('keeps the other preferences', () => {
    localStorage.setItem(storageKey, JSON.stringify({ lastSeenNotificationId: '9' }))
    updatePrefs(key, { theme: 'light' })
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ lastSeenNotificationId: '9', theme: 'light' })
  })

  it('returns false and does not throw when storage refuses the write', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      expect(updatePrefs(key, { theme: 'light' })).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('themeOf', () => {
  it('is dark unless light or system is stored', () => {
    expect(themeOf({})).toBe('dark')
    expect(themeOf({ theme: 'light' })).toBe('light')
    expect(themeOf({ theme: 'system' })).toBe('system')
    expect(themeOf({ theme: 'pink' })).toBe('dark')
    expect(themeOf({ theme: 1 })).toBe('dark')
  })
})

describe('defaultTimelineOf', () => {
  it('is home unless local or public is stored', () => {
    expect(defaultTimelineOf({})).toBe('home')
    expect(defaultTimelineOf({ defaultTimeline: 'local' })).toBe('local')
    expect(defaultTimelineOf({ defaultTimeline: 'public' })).toBe('public')
    expect(defaultTimelineOf({ defaultTimeline: '/evil' })).toBe('home')
  })

  it('is home for a value that is not a string', () => {
    expect(defaultTimelineOf({ defaultTimeline: ['local'] })).toBe('home')
  })
})

describe('shortcutsOf', () => {
  it('is on unless false is stored', () => {
    expect(shortcutsOf({})).toBe(true)
    expect(shortcutsOf({ shortcuts: true })).toBe(true)
    expect(shortcutsOf({ shortcuts: false })).toBe(false)
    expect(shortcutsOf({ shortcuts: 'false' })).toBe(true)
  })
})

describe('storageWorks', () => {
  it('is true when a write works, and leaves nothing behind', () => {
    expect(storageWorks()).toBe(true)
    expect(localStorage.length).toBe(0)
  })

  it('is false when storage refuses the write', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      expect(storageWorks()).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
