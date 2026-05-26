import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LitroRouter } from '@beatzball/litro-router'

// Spy on the real LitroRouter.go (rather than vi.mock'ing the module).
// vi.mock doesn't intercept dynamic imports made from inside node_modules
// because Vitest's transformer skips node_modules by default — the click
// handler's `import('@beatzball/litro-router')` inside the patched LitroLink
// would otherwise get the real module while the test holds a different
// (mocked) reference. vi.spyOn replaces the static method on the real class
// so both static and dynamic imports observe the same spied callable.
const goSpy = vi.spyOn(LitroRouter, 'go').mockImplementation(() => {})

beforeAll(async () => {
  // Side-effect import — triggers LitroLink.define().
  await import('@beatzball/litro/adapter/elena/runtime')
})

beforeEach(() => {
  document.body.innerHTML = ''
  goSpy.mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function flush() {
  // Drain microtasks after a click so the click handler's
  // `void import(...).then(...)` chain runs to completion: one tick for the
  // dynamic-import promise, one for the .then() callback. A small setTimeout
  // covers any extra microtask hops added by Vitest's module loader.
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('<litro-link> composite click handler', () => {
  it('intercepts a main-button click on the inner <a> and routes via LitroRouter', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const a = document.querySelector('a')!
    a.click()
    await flush()
    expect(goSpy).toHaveBeenCalledWith('/foo')
  })

  it('ignores middle-click (button !== 0)', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const a = document.querySelector('a')!
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, button: 1 }))
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks with modifier keys', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const a = document.querySelector('a')!
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      goSpy.mockClear()
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, [modifier]: true }))
      await flush()
      expect(goSpy, `should not route with ${modifier}`).not.toHaveBeenCalled()
    }
  })

  it('ignores clicks on <a target="_blank">', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo" target="_blank">x</a></litro-link>`
    await Promise.resolve()
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks on external <a href="https://…">', async () => {
    document.body.innerHTML = `<litro-link><a href="https://example.com/x">x</a></litro-link>`
    await Promise.resolve()
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks on fragment <a href="#section">', async () => {
    document.body.innerHTML = `<litro-link><a href="#section">x</a></litro-link>`
    await Promise.resolve()
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks on the host that do not hit any <a>', async () => {
    document.body.innerHTML = `<litro-link><span>no anchor here</span></litro-link>`
    await Promise.resolve()
    document.querySelector('span')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('respects defaultPrevented from a prior capture-phase listener', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    // Register on document.body, not the litro-link host: capture phase
    // traverses document → body → litro-link → a, so the body listener
    // runs BEFORE the host listener and can set defaultPrevented in time.
    // Listeners on the same element + same phase fire in registration
    // order; production registers first via connectedCallback, so a
    // sibling listener on the host wouldn't preempt it.
    const preventer = (e: Event) => e.preventDefault()
    document.body.addEventListener('click', preventer, true)
    try {
      document.querySelector('a')!.click()
      await flush()
      expect(goSpy).not.toHaveBeenCalled()
    } finally {
      document.body.removeEventListener('click', preventer, true)
    }
  })
})
