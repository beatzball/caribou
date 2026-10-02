import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM

// The module memoizes for the lifetime of a document, so each test loads a
// fresh copy to stand in for a fresh document.
async function freshModule() {
  vi.resetModules()
  return import('../_error-code.js')
}

describe('getCapturedCode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    happyDOM.setURL('http://localhost/')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when nothing signalled an error', async () => {
    const { getCapturedCode } = await freshModule()
    expect(getCapturedCode()).toBeNull()
  })

  it('reads the code from ?error=', async () => {
    happyDOM.setURL('http://localhost/?error=denied')
    const { getCapturedCode } = await freshModule()
    expect(getCapturedCode()).toBe('denied')
  })

  it('reads the code from sessionStorage and consumes it', async () => {
    sessionStorage.setItem('caribou.error', 'unauthorized')
    const { getCapturedCode } = await freshModule()
    expect(getCapturedCode()).toBe('unauthorized')
    expect(sessionStorage.getItem('caribou.error')).toBeNull()
  })

  it('prefers sessionStorage over the query param', async () => {
    happyDOM.setURL('http://localhost/?error=denied')
    sessionStorage.setItem('caribou.error', 'unauthorized')
    const { getCapturedCode } = await freshModule()
    expect(getCapturedCode()).toBe('unauthorized')
  })

  it('gives every later caller the same code, though the source is gone', async () => {
    sessionStorage.setItem('caribou.error', 'unauthorized')
    const { getCapturedCode } = await freshModule()
    expect(getCapturedCode()).toBe('unauthorized')
    expect(getCapturedCode()).toBe('unauthorized')

    happyDOM.setURL('http://localhost/?error=denied')
    const second = await freshModule()
    expect(second.getCapturedCode()).toBe('denied')
    vi.runAllTimers()
    expect(location.search).toBe('')
    expect(second.getCapturedCode()).toBe('denied')
  })

  it('leaves ?error= in the URL at first, then strips it', async () => {
    happyDOM.setURL('http://localhost/?error=denied')
    const { getCapturedCode } = await freshModule()
    getCapturedCode()
    if (document.readyState !== 'complete') window.dispatchEvent(new Event('load'))

    vi.advanceTimersByTime(249)
    expect(location.search).toBe('?error=denied')

    vi.advanceTimersByTime(1)
    expect(location.pathname + location.search).toBe('/')
  })

  it('strips ?instance= with the error and keeps other params', async () => {
    happyDOM.setURL('http://localhost/?error=unreachable&instance=example.social&keep=1')
    const { getCapturedCode } = await freshModule()
    getCapturedCode()
    if (document.readyState !== 'complete') window.dispatchEvent(new Event('load'))
    vi.runAllTimers()
    expect(location.search).toBe('?keep=1')
  })

  it('does not touch the URL when the code came from sessionStorage', async () => {
    happyDOM.setURL('http://localhost/?instance=example.social')
    sessionStorage.setItem('caribou.error', 'unauthorized')
    const replaceState = vi.spyOn(history, 'replaceState')
    const { getCapturedCode } = await freshModule()
    getCapturedCode()
    vi.runAllTimers()
    expect(replaceState).not.toHaveBeenCalled()
    replaceState.mockRestore()
  })
})
