import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_VEIL_HEAD } from '../../server/lib/reader-veil-head.js'

// Runs the head script the way the browser does, before any app code.
function run() {
  const script = /<script>([\s\S]*)<\/script>/.exec(READER_VEIL_HEAD)![1]!
  new Function(script)()
}

const root = document.documentElement

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  root.removeAttribute('data-caribou-reader-check')
})
afterEach(() => { vi.useRealTimers() })

describe('reader veil head', () => {
  it('marks <html> when an account is active, and the style hides posts then', () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    run()
    expect(root.hasAttribute('data-caribou-reader-check')).toBe(true)
    expect(READER_VEIL_HEAD).toContain('html[data-caribou-reader-check]{--caribou-reader-veil:hidden}')
  })

  it('does nothing with no account, or a malformed one, or blocked storage', () => {
    run()
    localStorage.setItem('caribou.activeUserKey', 'null')
    run()
    localStorage.setItem('caribou.activeUserKey', '{not json')
    run()
    expect(root.hasAttribute('data-caribou-reader-check')).toBe(false)
  })

  // A slow or failed app download must not show posts nobody has checked.
  it('never takes the mark off by itself; after 15 s it says why posts are hidden, with Reload', () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    run()
    vi.advanceTimersByTime(14_999)
    expect(document.getElementById('caribou-reader-stalled')).toBeNull()
    vi.advanceTimersByTime(1)
    const note = document.getElementById('caribou-reader-stalled')!
    expect(note.textContent).toContain('Posts are hidden until Caribou has checked them')
    expect(note.querySelector('a')!.textContent).toBe('Reload')
    vi.advanceTimersByTime(600_000)
    expect(root.hasAttribute('data-caribou-reader-check')).toBe(true)
    note.remove()
  })

  it('the app cancels that timer when it starts', () => {
    localStorage.setItem('caribou.activeUserKey', JSON.stringify('alice@example.social'))
    run()
    clearTimeout((window as unknown as { __caribouReaderVeil?: number }).__caribouReaderVeil)
    vi.advanceTimersByTime(20_000)
    expect(document.getElementById('caribou-reader-stalled')).toBeNull()
  })
})
