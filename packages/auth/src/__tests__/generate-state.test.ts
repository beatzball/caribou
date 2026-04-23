import { describe, expect, it } from 'vitest'
import { generateState } from '../generate-state.js'

describe('generateState', () => {
  it('returns a base64url string with no +, /, or = padding', () => {
    const s = generateState()
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('encodes 32 bytes (produces 43 base64url chars)', () => {
    expect(generateState()).toHaveLength(43)
  })

  it('produces distinct values on repeated calls', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateState()))
    expect(set.size).toBe(100)
  })
})
