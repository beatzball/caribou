import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installPreloadErrorReload, reloadOnce, resetStaleBuildReload, withStaleBuildReload,
} from '../_stale-build.js'

describe('stale build reload', () => {
  let assign: ReturnType<typeof vi.fn<(href: string) => void>>

  beforeEach(() => {
    sessionStorage.clear()
    resetStaleBuildReload()
    assign = vi.fn<(href: string) => void>()
  })

  it('loads the target URL when a route import fails', async () => {
    const [route] = withStaleBuildReload([{ path: '/local', action: () => Promise.reject(new Error('404')) }], assign)
    void route!.action!()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).toHaveBeenCalledWith(location.href)
  })

  it('does not load again when an import fails soon after a load, so it cannot loop', async () => {
    sessionStorage.setItem('caribou.stale-reload', String(Date.now() - 5_000))
    const [route] = withStaleBuildReload([{ path: '/local', action: () => Promise.reject(new Error('404')) }], assign)
    await expect(route!.action!()).rejects.toThrow('404')
    expect(assign).not.toHaveBeenCalled()
  })

  it('recovers the tab again after a later deploy', () => {
    const at = 1_000_000
    sessionStorage.setItem('caribou.stale-reload', String(at))
    expect(reloadOnce('https://example.test/public', assign, at + 29_999)).toBe(false)
    expect(reloadOnce('https://example.test/public', assign, at + 30_000)).toBe(true)
    expect(assign).toHaveBeenCalledOnce()
  })

  it('a successful import leaves the guard in place', async () => {
    sessionStorage.setItem('caribou.stale-reload', '123')
    const [route] = withStaleBuildReload([{ path: '/local', action: async () => {} }], assign)
    await route!.action!()
    expect(sessionStorage.getItem('caribou.stale-reload')).toBe('123')
  })

  it('acts once when vite:preloadError and the route action see the same failure', async () => {
    const target = new EventTarget()
    installPreloadErrorReload(target, assign)
    const [route] = withStaleBuildReload([{ path: '/local', action: () => {
      target.dispatchEvent(new Event('vite:preloadError'))
      return Promise.reject(new Error('404'))
    } }], assign)
    void route!.action!()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('does nothing without sessionStorage, so it cannot loop', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied') } })
    try {
      expect(reloadOnce('https://example.test/local', assign)).toBe(false)
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves a route without an action alone', () => {
    const route: { path: string; action?: () => Promise<void> } = { path: '/x' }
    expect(withStaleBuildReload([route], assign)[0]).toBe(route)
  })
})
