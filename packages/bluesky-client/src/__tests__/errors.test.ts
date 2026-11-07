import { CaribouError } from '@beatzball/caribou-mastodon-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeXrpcError } from '../errors.js'

const xrpc = (status: number, error = '', message = 'm', headers?: Record<string, string>) =>
  Object.assign(new Error(message), { status, error, headers })

describe('normalizeXrpcError', () => {
  afterEach(() => { vi.useRealTimers() })

  it('keeps a CaribouError', () => {
    const e = new CaribouError('not_found', 'x')
    expect(normalizeXrpcError(e)).toBe(e)
  })

  it.each([
    [xrpc(1), 'unreachable'],
    [xrpc(401), 'unauthorized'],
    [xrpc(404), 'not_found'],
    [xrpc(400, 'NotFound'), 'not_found'],
    [xrpc(400, 'AccountTakedown'), 'not_found'],
    [xrpc(400, 'InvalidRequest', 'Profile not found'), 'not_found'],
    [xrpc(400, 'InvalidRequest', 'bad cursor'), 'unknown'],
    [xrpc(500), 'server_error'],
    [xrpc(502, 'UpstreamFailure'), 'server_error'],
    [new TypeError('Failed to fetch'), 'unreachable'],
    [new TypeError('x is not a function'), 'unknown'],
    ['boom', 'unknown'],
  ])('%s → %s', (err, code) => {
    expect(normalizeXrpcError(err).code).toBe(code)
  })

  it('reads the wait after a 429 from ratelimit-reset', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000_000 * 1000))
    const e = normalizeXrpcError(xrpc(429, 'RateLimitExceeded', 'm', { 'ratelimit-reset': String(1_000_000 + 30) }))
    expect(e).toMatchObject({ code: 'rate_limited', retryAfter: 30, status: 429 })
  })

  it('reads retry-after, or no wait at all', () => {
    expect(normalizeXrpcError(xrpc(429, '', 'm', { 'retry-after': '7' })).retryAfter).toBe(7)
    expect(normalizeXrpcError(xrpc(429)).retryAfter).toBeUndefined()
    expect(normalizeXrpcError(xrpc(429, '', 'm', { 'ratelimit-reset': 'soon' })).retryAfter).toBeUndefined()
  })
})
