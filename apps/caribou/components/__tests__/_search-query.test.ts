import { describe, expect, it } from 'vitest'
import { isUrlQuery, parseSearch, resolvedPath, searchPath } from '../_search-query.js'

const account = (over: Record<string, unknown> = {}) => ({
  id: '1', acct: 'bob@other.social', url: 'https://other.social/@bob', uri: 'https://other.social/users/bob', ...over,
})
const status = (over: Record<string, unknown> = {}) => ({
  id: '99', url: 'https://other.social/@bob/5', uri: 'https://other.social/users/bob/statuses/5',
  account: account(), ...over,
})

describe('parseSearch', () => {
  it('reads q and type from a query string', () => {
    expect(parseSearch('?q=cats&type=hashtags')).toEqual({ q: 'cats', type: 'hashtags' })
  })
  it('defaults to People and an empty query', () => {
    expect(parseSearch('')).toEqual({ q: '', type: 'accounts' })
  })
  it('ignores an unknown type', () => {
    expect(parseSearch('?q=x&type=lists')).toEqual({ q: 'x', type: 'accounts' })
  })
  it('takes a record from the server', () => {
    expect(parseSearch({ q: 'a b', type: 'statuses' })).toEqual({ q: 'a b', type: 'statuses' })
    expect(parseSearch({ q: ['a', 'b'] })).toEqual({ q: 'a', type: 'accounts' })
  })
})

describe('searchPath', () => {
  it('leaves the type out for People', () => {
    expect(searchPath('cats', 'accounts')).toBe('/search?q=cats')
  })
  it('encodes the query and keeps other types', () => {
    expect(searchPath('#café & tea', 'hashtags')).toBe('/search?q=%23caf%C3%A9+%26+tea&type=hashtags')
  })
  it('is plain /search for nothing', () => {
    expect(searchPath('', 'accounts')).toBe('/search')
    expect(searchPath('', 'statuses')).toBe('/search?type=statuses')
  })
  it('round-trips through parseSearch', () => {
    const p = searchPath('a+b ?=&', 'statuses')
    expect(parseSearch(p.slice('/search'.length))).toEqual({ q: 'a+b ?=&', type: 'statuses' })
  })
})

describe('isUrlQuery', () => {
  it('accepts an http or https URL with a host', () => {
    expect(isUrlQuery('https://other.social/@bob/5')).toBe(true)
    expect(isUrlQuery('  http://other.social/@bob  ')).toBe(true)
  })
  it('refuses words, handles and other schemes', () => {
    expect(isUrlQuery('cats')).toBe(false)
    expect(isUrlQuery('@bob@other.social')).toBe(false)
    expect(isUrlQuery('javascript:alert(1)')).toBe(false)
    expect(isUrlQuery('https://')).toBe(false)
    expect(isUrlQuery('https://a b')).toBe(false)
  })
})

describe('resolvedPath', () => {
  const url = 'https://other.social/@bob/5'
  it('opens the one post the server found', () => {
    expect(resolvedPath(url, { accounts: [], statuses: [status()] }, 'home.social'))
      .toBe('/@bob@other.social/99')
  })
  it('opens the one account the server found', () => {
    expect(resolvedPath('https://other.social/@bob', { accounts: [account()], statuses: [] }, 'home.social'))
      .toBe('/@bob@other.social')
  })
  it('adds the host to a local account', () => {
    expect(resolvedPath('https://home.social/@me', { accounts: [account({ acct: 'me', url: 'https://home.social/@me' })], statuses: [] }, 'home.social'))
      .toBe('/@me@home.social')
  })
  it('prefers a post whose url or uri is the query', () => {
    const other = status({ id: '1', url: 'https://x/1', uri: 'https://x/1' })
    expect(resolvedPath(url, { accounts: [account()], statuses: [other, status()] }, 'h')).toBe('/@bob@other.social/99')
    const byUri = 'https://other.social/users/bob/statuses/5'
    expect(resolvedPath(byUri, { accounts: [], statuses: [other, status()] }, 'h')).toBe('/@bob@other.social/99')
  })
  it('prefers an account whose url is the query', () => {
    const other = account({ id: '2', acct: 'carol', url: 'https://x/@carol', uri: 'https://x/u/carol' })
    expect(resolvedPath('https://other.social/@bob', { accounts: [other, account()], statuses: [] }, 'h'))
      .toBe('/@bob@other.social')
  })
  // Review round 1 (Codex 2, Fable F3): the answer is checked before it
  // becomes a path.
  it('refuses an acct with a path separator or a dot segment', () => {
    const bad = ['bob@other.social/../../settings', 'bob/x', '..', 'bob@..', 'bob@other.social?x', 'bob#x', '', '@', 'bob@']
    for (const acct of bad) {
      const a = account({ acct })
      expect(resolvedPath('https://other.social/@bob', { accounts: [a], statuses: [] }, 'home.social'), acct).toBeNull()
      expect(resolvedPath(url, { accounts: [], statuses: [status({ account: a })] }, 'home.social'), acct).toBeNull()
    }
  })
  it('refuses a malformed status instead of throwing', () => {
    const noAccount = { ...status(), account: undefined } as unknown as ReturnType<typeof status>
    expect(resolvedPath(url, { accounts: [], statuses: [noAccount] }, 'h')).toBeNull()
    expect(resolvedPath(url, { accounts: [], statuses: [status({ id: '' })] }, 'h')).toBeNull()
    expect(resolvedPath(url, { accounts: [], statuses: [status({ id: 5 })] }, 'h')).toBeNull()
    expect(resolvedPath(url, { accounts: [], statuses: [null as unknown as ReturnType<typeof status>] }, 'h')).toBeNull()
  })
  it('encodes a status id with a slash so it stays one segment', () => {
    expect(resolvedPath(url, { accounts: [], statuses: [status({ id: 'a/../b' })] }, 'h')).toBe('/@bob@other.social/a%2F..%2Fb')
  })
  it('opens a lone answer only when it lives on the host of the address', () => {
    const carol = account({ acct: 'carol@another.social', url: 'https://another.social/@carol', uri: 'https://another.social/users/carol' })
    expect(resolvedPath('https://other.social/@bob', { accounts: [carol], statuses: [] }, 'h')).toBeNull()
    const elsewhere = status({ url: 'https://another.social/@carol/1', uri: 'https://another.social/users/carol/statuses/1' })
    expect(resolvedPath(url, { accounts: [], statuses: [elsewhere] }, 'h')).toBeNull()
    // The same server under another address form is the same post.
    const alias = status({ url: 'https://other.social/@bob/5', uri: 'https://other.social/users/bob/statuses/5' })
    expect(resolvedPath('https://other.social/web/statuses/5', { accounts: [], statuses: [alias] }, 'h')).toBe('/@bob@other.social/99')
  })
  it('opens nothing when the match is unclear or empty', () => {
    expect(resolvedPath(url, { accounts: [], statuses: [] }, 'h')).toBeNull()
    expect(resolvedPath(url, { accounts: [account()], statuses: [status({ url: 'https://x/1', uri: 'https://x/1' })] }, 'h')).toBeNull()
    expect(resolvedPath('cats', { accounts: [account()], statuses: [] }, 'h')).toBeNull()
  })
})
