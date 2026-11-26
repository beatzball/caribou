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

  it('a chunk the browser drops because the page is leaving does not reload', () => {
    // Firefox fails a dynamic import still loading when the page navigates
    // away. A reload then would cancel the reader's own navigation.
    const target = new EventTarget()
    installPreloadErrorReload(target, env)
    target.dispatchEvent(new Event('beforeunload'))
    target.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: loadError() }))
    expect(assign).not.toHaveBeenCalled()
    // Back from the back-forward cache: the page is live again.
    target.dispatchEvent(new Event('pageshow'))
    target.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: loadError() }))
    expect(assign).toHaveBeenCalledOnce()
  })

  // A route action whose import is still loading. `fail()` rejects it the
  // way the browser does when it drops the request.
  function pendingRoute(path: string) {
    let fail!: () => void
    const [route] = withStaleBuildReload([{ path, action: () => new Promise<void>((_, reject) => {
      fail = () => reject(loadError())
    }) }], env)
    return { route: route!, fail: () => fail() }
  }

  it('a route import the browser drops because the page is leaving does not reload', async () => {
    // WebKit fails the page chunk of a full load of `/` when the reader
    // leaves at once. A load of `/` then cancels their navigation.
    const target = new EventTarget()
    installPreloadErrorReload(target, env)
    const { route, fail } = pendingRoute('/')
    let settled = false
    void route.action!().then(() => { settled = true }, () => { settled = true })
    target.dispatchEvent(new Event('beforeunload'))
    fail()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    // The router keeps waiting: it neither mounts the page nor stops.
    expect(settled).toBe(false)
    expect(sessionStorage.getItem('caribou.stale-reload')).toBeNull()
    // Back from the back-forward cache: the page is live again.
    target.dispatchEvent(new Event('pageshow'))
    void route.action!().catch(() => {})
    fail()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).toHaveBeenCalledOnce()
  })

  it('a route that starts while the page is leaving does not reload either', async () => {
    // The app's first route can start after `beforeunload`; the browser then
    // fails its import at once.
    const target = new EventTarget()
    installPreloadErrorReload(target, env)
    target.dispatchEvent(new Event('beforeunload'))
    const [route] = withStaleBuildReload([{ path: '/', action: () => Promise.reject(loadError()) }], env)
    void route!.action!()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).not.toHaveBeenCalled()
  })

  it('after a leave that did not happen, the next tap on a link still recovers a stale tab', async () => {
    // A link that downloads a file fires `beforeunload`, and the page stays.
    // No `pageshow` follows.
    const target = new EventTarget()
    installPreloadErrorReload(target, env)
    target.dispatchEvent(new Event('beforeunload'))
    const [route] = withStaleBuildReload([{ path: '/local', action: () => Promise.reject(loadError()) }], env)
    target.dispatchEvent(new Event('pointerdown'))
    void route!.action!()
    await Promise.resolve()
    await Promise.resolve()
    expect(assign).toHaveBeenCalledWith(location.href)
    expect(console.error).toHaveBeenCalledOnce()
  })

  for (const make of [() => new Event('pointerdown'), () => new Event('keydown')]) {
    const type = make().type
    it(`after a leave that did not happen, the reader's ${type} lets a chunk failure reload again`, () => {
      const target = new EventTarget()
      installPreloadErrorReload(target, env)
      target.dispatchEvent(new Event('beforeunload'))
      target.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: loadError() }))
      expect(assign).not.toHaveBeenCalled()
      target.dispatchEvent(make())
      target.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: loadError() }))
      expect(assign).toHaveBeenCalledOnce()
    })
  }

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
