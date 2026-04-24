import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPollHost, startPolling, type PollHost } from '../polling.js'

function makeHost(): PollHost & { visibilityState: DocumentVisibilityState } {
  let vis: DocumentVisibilityState = 'visible'
  const listeners = new Set<() => void>()
  return {
    get visibilityState() { return vis },
    set visibilityState(v) { vis = v; for (const fn of listeners) fn() },
    addVisibilityListener(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('startPolling', () => {
  it('invokes fn every intervalMs while visible', () => {
    const host = makeHost()
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    vi.advanceTimersByTime(2500)
    expect(fn).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not invoke fn when document is hidden', () => {
    const host = makeHost()
    host.visibilityState = 'hidden'
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
    stop()
  })

  it('fires immediate one-shot on hidden → visible transition', () => {
    const host = makeHost()
    host.visibilityState = 'hidden'
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    host.visibilityState = 'visible'
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stop() prevents further invocations', () => {
    const host = makeHost()
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    stop()
    vi.advanceTimersByTime(5000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('stops the timer on visible -> hidden transition', () => {
    const host = makeHost()
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    vi.advanceTimersByTime(1500)
    expect(fn).toHaveBeenCalledTimes(1)
    host.visibilityState = 'hidden'
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
  })

  it('ignores visibility events after stop()', () => {
    const host = makeHost()
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn, host })
    stop()
    host.visibilityState = 'hidden'
    host.visibilityState = 'visible'
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('defaultPollHost', () => {
  it('reads document.visibilityState and registers listeners on document', () => {
    const host = defaultPollHost()
    expect(host.visibilityState).toBe(document.visibilityState)
    const fn = vi.fn()
    const unlisten = host.addVisibilityListener(fn)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(1)
    unlisten()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('startPolling uses defaultPollHost when none provided', () => {
    const fn = vi.fn()
    const stop = startPolling({ intervalMs: 1000, fn })
    stop()
  })
})
