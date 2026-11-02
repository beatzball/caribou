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
    expect(resolvedPath('https://home.social/@me', { accounts: [account({ acct: 'me' })], statuses: [] }, 'home.social'))
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
  it('opens nothing when the match is unclear or empty', () => {
    expect(resolvedPath(url, { accounts: [], statuses: [] }, 'h')).toBeNull()
    expect(resolvedPath(url, { accounts: [account()], statuses: [status({ url: 'https://x/1', uri: 'https://x/1' })] }, 'h')).toBeNull()
    expect(resolvedPath('cats', { accounts: [account()], statuses: [] }, 'h')).toBeNull()
  })
})
