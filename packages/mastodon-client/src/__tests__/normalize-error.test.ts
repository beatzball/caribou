import { describe, expect, it } from 'vitest'
import { CaribouError } from '../caribou-error.js'
import { normalizeError } from '../normalize-error.js'

class FakeHttpError extends Error {
  readonly statusCode: number
  readonly headers: Record<string, string>
  constructor(statusCode: number, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.headers = headers
  }
}

describe('normalizeError', () => {
  it('maps 401 to unauthorized', () => {
    const e = normalizeError(new FakeHttpError(401, 'bad token'))
    expect(e).toBeInstanceOf(CaribouError)
    expect(e.code).toBe('unauthorized')
  })

  it('maps 404 to not_found', () => {
    expect(normalizeError(new FakeHttpError(404, '')).code).toBe('not_found')
  })

  it('maps 429 to rate_limited with retryAfter', () => {
    const e = normalizeError(new FakeHttpError(429, '', { 'retry-after': '120' }))
    expect(e.code).toBe('rate_limited')
    expect(e.retryAfter).toBe(120)
  })

  it('maps 5xx to server_error', () => {
    expect(normalizeError(new FakeHttpError(500, '')).code).toBe('server_error')
    expect(normalizeError(new FakeHttpError(502, '')).code).toBe('server_error')
  })

  it('maps generic TypeError/"fetch failed" to unreachable', () => {
    expect(normalizeError(new TypeError('fetch failed')).code).toBe('unreachable')
  })

  it('falls through to unknown', () => {
    expect(normalizeError(new Error('weird')).code).toBe('unknown')
  })

  it('returns CaribouError unchanged when given one', () => {
    const original = new CaribouError('rate_limited', 'x', { retryAfter: 5 })
    expect(normalizeError(original)).toBe(original)
  })
})
