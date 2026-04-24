import { describe, expect, it, vi } from 'vitest'
import { createDedup } from '../dedup.js'

describe('createDedup', () => {
  it('returns the same promise for concurrent calls with the same key', async () => {
    const dedup = createDedup()
    const underlying = vi.fn(async () => 'v')
    const [a, b] = await Promise.all([
      dedup.run('k', underlying),
      dedup.run('k', underlying),
    ])
    expect(a).toBe('v')
    expect(b).toBe('v')
    expect(underlying).toHaveBeenCalledTimes(1)
  })

  it('runs a new call after the previous has resolved', async () => {
    const dedup = createDedup()
    const underlying = vi.fn(async () => 'v')
    await dedup.run('k', underlying)
    await dedup.run('k', underlying)
    expect(underlying).toHaveBeenCalledTimes(2)
  })

  it('clears in-flight on rejection so retries run', async () => {
    const dedup = createDedup()
    let n = 0
    const underlying = vi.fn(async () => {
      n += 1
      if (n === 1) throw new Error('fail')
      return 'v'
    })
    await expect(dedup.run('k', underlying)).rejects.toThrow('fail')
    await expect(dedup.run('k', underlying)).resolves.toBe('v')
    expect(underlying).toHaveBeenCalledTimes(2)
  })

  it('different keys run independently', async () => {
    const dedup = createDedup()
    const fn = vi.fn(async (tag: string) => tag)
    const [a, b] = await Promise.all([
      dedup.run('a', () => fn('a')),
      dedup.run('b', () => fn('b')),
    ])
    expect(a).toBe('a'); expect(b).toBe('b')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
