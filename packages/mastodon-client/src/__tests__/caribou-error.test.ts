import { describe, expect, it } from 'vitest'
import { CaribouError } from '../caribou-error.js'

describe('CaribouError', () => {
  it('captures code and message', () => {
    const err = new CaribouError('unauthorized', 'token expired')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CaribouError')
    expect(err.code).toBe('unauthorized')
    expect(err.message).toBe('token expired')
    expect(err.retryAfter).toBeUndefined()
  })

  it('stores retryAfter when provided', () => {
    const err = new CaribouError('rate_limited', 'slow down', { retryAfter: 30 })
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfter).toBe(30)
  })

  it('omits retryAfter when not provided', () => {
    const err = new CaribouError('server_error', 'boom')
    expect('retryAfter' in err && err.retryAfter !== undefined).toBe(false)
  })
})
