import { describe, it, expect } from 'vitest'
import { getServerNowMs } from '../server-now.js'

describe('getServerNowMs', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now()
    const result = getServerNowMs()
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(after)
  })

  it('returns increasing values across calls', () => {
    const a = getServerNowMs()
    // Force a tiny gap.
    const b = (() => { const t0 = Date.now(); while (Date.now() === t0) {} return getServerNowMs() })()
    expect(b).toBeGreaterThan(a)
  })
})
