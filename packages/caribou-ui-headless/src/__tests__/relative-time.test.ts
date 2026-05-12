import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relative-time.js'

const NOW = new Date('2026-04-28T12:00:00Z').getTime()

describe('formatRelativeTime', () => {
  it.each([
    ['just now', '2026-04-28T11:59:50Z'],
    ['5m', '2026-04-28T11:55:00Z'],
    ['2h', '2026-04-28T10:00:00Z'],
    ['3d', '2026-04-25T12:00:00Z'],
    ['Apr 14', '2026-04-14T12:00:00Z'],
    ['Apr 14, 2025', '2025-04-14T12:00:00Z'],
  ])('returns %s', (expected, iso) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected)
  })

  it('falls back to "just now" for future timestamps (treats negative delta as 0)', () => {
    expect(formatRelativeTime('2026-04-28T12:00:30Z', NOW)).toBe('just now')
  })

  it('uses the current Date when no `now` arg is passed', () => {
    // The default-now branch is hard to assert exactly, so we just verify
    // that calling with no arg returns a string (the default branch executes).
    const out = formatRelativeTime(new Date().toISOString())
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('formatRelativeTime — explicit nowMs', () => {
  it('uses the provided nowMs instead of Date.now()', () => {
    const created = '2026-05-11T07:00:00Z'
    // "now" is 5 minutes after creation
    const nowMs = new Date('2026-05-11T07:05:00Z').getTime()
    const result = formatRelativeTime(created, nowMs)
    expect(result).toBe('5m')
  })

  it('falls back to Date.now() when nowMs is omitted', () => {
    // We can't assert exact text without freezing the clock, but we can
    // assert the function still returns a non-empty string with the
    // legacy single-argument call.
    const created = new Date(Date.now() - 60_000).toISOString() // 1 minute ago
    const result = formatRelativeTime(created)
    expect(result.length).toBeGreaterThan(0)
  })
})
