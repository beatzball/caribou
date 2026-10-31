import { describe, expect, it } from 'vitest'
import { shellInfo } from '../shell-info.js'

describe('shellInfo', () => {
  it.each([
    [{ instance: 'example.social', source: 'cookie' as const }, { instance: 'example.social', source: 'cookie' }],
    [{ instance: 'example.social', source: 'path' as const }, { instance: 'example.social', source: 'path' }],
    [{ instance: null }, { instance: null }],
  ])('%j -> %j', (resolution, shell) => {
    expect(shellInfo(resolution)).toEqual(shell)
  })
})
