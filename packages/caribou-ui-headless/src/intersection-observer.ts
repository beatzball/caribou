// Thin wrapper over the platform IntersectionObserver. The wrapper exists
// so call sites that need a different observer impl in tests (or a
// polyfill in older browsers) have a single seam to swap. Today it just
// forwards to the native API.

export interface CaribouIntersectionObserver {
  observe(el: Element): void
  disconnect(): void
}

interface CaribouIntersectionObserverInternal extends CaribouIntersectionObserver {
  /** Underlying observer — exposed for tests to spy on. */
  _io: IntersectionObserver
}

export function createIntersectionObserver(
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit,
): CaribouIntersectionObserver {
  const _io = new IntersectionObserver((entries) => {
    for (const e of entries) callback(e)
  }, options)
  const wrapper: CaribouIntersectionObserverInternal = {
    _io,
    observe: (el: Element) => _io.observe(el),
    disconnect: () => _io.disconnect(),
  }
  return wrapper
}
