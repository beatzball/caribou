import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  documentBuildVersion, installPreloadErrorReload, isModuleLoadError, reloadOnce,
  resetStaleBuildReload, withStaleBuildReload, type StaleBuildEnv,
} from '../_stale-build.js'

// What Chromium rejects a 404'd `import()` with.
const loadError = () => new TypeError('Failed to fetch dynamically imported module: https://example.test/_litro/assets/public-x.js')

describe('stale build reload', () => {
  let assign: ReturnType<typeof vi.fn<(href: string) => void>>
  let env: StaleBuildEnv & { v: string; up: boolean }

  // A new document: the module state starts over, sessionStorage stays.
  function newDocument(version: string) {
    resetStaleBuildReload()
    env.v = version
  }

  beforeEach(() => {
    sessionStorage.clear()
    resetStaleBuildReload()
    assign = vi.fn<(href: string) => void>()
    env = { v: 'aaaa', up: true, assign, version: () => env.v, online: () => env.up }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('loads the target URL when a route import fails, and says why', async () => {
    const [route] = withStaleBuildReload([{ path: '/local', action: () => Promise.reject(loadError()) }], env)
    void route!.action!()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).toHaveBeenCalledWith(location.href)
    expect(console.error).toHaveBeenCalledOnce()
  })

  it('a persistent failure stops after one load per build, however slow each load is', () => {
    const href = 'https://example.test/public'
    // Old tab, build aaaa: load the page.
    expect(reloadOnce(href, env)).toBe(true)
    // The full load runs the deployed build bbbb; the chunk is missing there
    // too: one more load, since that pair was never tried.
    newDocument('bbbb')
    expect(reloadOnce(href, env)).toBe(true)
    // Every later load is bbbb again, whenever it happens: no more loads.
    for (let i = 0; i < 5; i++) {
      newDocument('bbbb')
      expect(reloadOnce(href, env)).toBe(false)
    }
    expect(assign).toHaveBeenCalledTimes(2)
  })

  it('a later deploy may recover the same tab and URL again', () => {
    const href = 'https://example.test/public'
    expect(reloadOnce(href, env)).toBe(true)
    newDocument('aaaa')
    expect(reloadOnce(href, env)).toBe(false)
    newDocument('cccc')
    expect(reloadOnce(href, env)).toBe(true)
  })

  it('rethrows once the pair was tried', async () => {
    const [route] = withStaleBuildReload([{ path: '/local', action: () => Promise.reject(loadError()) }], env)
    reloadOnce(location.href, env)
    newDocument('aaaa')
    await expect(route!.action!()).rejects.toThrow('dynamically imported module')
    expect(assign).toHaveBeenCalledOnce()
  })

  it('a module that loaded and threw is not a stale tab', async () => {
    const [route] = withStaleBuildReload([{ path: '/local', action: () => Promise.reject(new ReferenceError('x is not defined')) }], env)
    await expect(route!.action!()).rejects.toThrow('x is not defined')
    expect(assign).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('caribou.stale-reload')).toBeNull()
  })

  it('does not load while offline', () => {
    env.up = false
    expect(reloadOnce('https://example.test/public', env)).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })

  it('acts once when vite:preloadError and the route action see the same failure', async () => {
    const target = new EventTarget()
    installPreloadErrorReload(target, env)
    const [route] = withStaleBuildReload([{ path: '/local', action: () => {
      const err = loadError()
      target.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: err }))
      return Promise.reject(err)
    } }], env)
    void route!.action!()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('ignores a vite:preloadError that is not a load failure', () => {
    const target = new EventTarget()
    installPreloadErrorReload(target, env)
    target.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: new ReferenceError('boom') }))
    expect(assign).not.toHaveBeenCalled()
  })

  it('does nothing without sessionStorage, so it cannot loop', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('denied') } })
    try {
      expect(reloadOnce('https://example.test/local', env)).toBe(false)
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves a route without an action alone', () => {
    const route: { path: string; action?: () => Promise<void> } = { path: '/x' }
    expect(withStaleBuildReload([route], env)[0]).toBe(route)
  })
})

describe('isModuleLoadError', () => {
  it('knows each engine’s wording', () => {
    expect(isModuleLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true)
    expect(isModuleLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true)
    expect(isModuleLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isModuleLoadError(new TypeError('x is not a function'))).toBe(false)
    expect(isModuleLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(false)
  })
})

describe('documentBuildVersion', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('reads ?v= from the entry script', () => {
    document.head.innerHTML = '<script type="module" src="/_litro/app.js?v=0123456789ab"></script>'
    expect(documentBuildVersion()).toBe('0123456789ab')
  })

  it('is empty without a versioned entry', () => {
    expect(documentBuildVersion()).toBe('')
    document.head.innerHTML = '<script type="module" src="/_litro/app.js"></script>'
    expect(documentBuildVersion()).toBe('')
  })
})
