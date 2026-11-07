import { describe, expect, it } from 'vitest'
import { BLUESKY_FLAG_KEY, blueskyEnabled } from '../_bluesky.js'

describe('blueskyEnabled', () => {
  const win = (value: string | null) =>
    ({ localStorage: { getItem: (k: string) => (k === BLUESKY_FLAG_KEY ? value : null) } }) as unknown as Window

  it('is on only for "1"', () => {
    expect(blueskyEnabled(win('1'))).toBe(true)
    expect(blueskyEnabled(win(null))).toBe(false)
    expect(blueskyEnabled(win('true'))).toBe(false)
  })

  it('reads a missing window as off', () => {
    expect(blueskyEnabled(undefined)).toBe(false)
  })

  it('reads blocked storage as off, even when reading localStorage itself throws', () => {
    const blocked = {} as Window
    Object.defineProperty(blocked, 'localStorage', { get: () => { throw new DOMException('denied', 'SecurityError') } })
    expect(blueskyEnabled(blocked)).toBe(false)
  })
})
