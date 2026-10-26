import { afterEach, describe, expect, it } from 'vitest'
import { activeUserKey } from '../users.js'
import { clearKeptAlive, createKeepAlive, ownerGeneration } from '../keep-alive.js'

type Key = NonNullable<typeof activeUserKey.value>
const alice = 'alice@example.social' as Key
const bob = 'bob@example.social' as Key

afterEach(() => {
  activeUserKey.value = null
  clearKeptAlive()
})

describe('createKeepAlive', () => {
  it('drops the least recently used entry past the limit', () => {
    const cache = createKeepAlive<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })

  it('makes an entry once with getOrCreate', () => {
    const cache = createKeepAlive<object>(4)
    const made = cache.getOrCreate('k', () => ({}))
    expect(cache.getOrCreate('k', () => ({}))).toBe(made)
  })

  it('empties itself when the active account changes', () => {
    activeUserKey.value = alice
    const cache = createKeepAlive<number>(4)
    cache.set('home', 1)
    activeUserKey.value = bob
    expect(cache.size).toBe(0)
    cache.set('home', 2)
    activeUserKey.value = null
    expect(cache.get('home')).toBeUndefined()
  })

  it('keeps its entries while the account stays the same', () => {
    activeUserKey.value = alice
    const cache = createKeepAlive<number>(4)
    cache.set('home', 1)
    activeUserKey.value = alice
    expect(cache.get('home')).toBe(1)
  })

  it('gives a new owner generation for every change, even back to the same account', () => {
    activeUserKey.value = alice
    const start = ownerGeneration()
    activeUserKey.value = bob
    activeUserKey.value = alice
    expect(ownerGeneration()).not.toBe(start)
    const now = ownerGeneration()
    expect(ownerGeneration()).toBe(now)
  })
})
