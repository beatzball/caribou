import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TEXT_SIZE, TEXT_SIZES, TEXT_SIZE_CSS, TEXT_SIZE_PERCENT, applyTextSize, currentTextSize, setTextSize,
  startTextSize, textSize, textSizeFromStorage, textSizeOf, type TextSize,
} from '../_text-size.js'
import { SIGNIN_FALLBACK_PAGE } from '../../server/lib/signin-complete-page.js'
import { TEXT_SIZE_HEAD, TEXT_SIZE_SCRIPT } from '../../server/lib/text-size-head.js'
import { TOKENS_CSS } from '../../server/lib/tokens-head.generated.js'

type Store = Record<string, string>

// Each case: localStorage, and the step that must be on <html> (`md`, the
// default, is no attribute). The head script and the client must agree.
const CASES: Array<[string, Store | null, TextSize]> = [
  ['nothing stored', {}, 'md'],
  ['smallest', { 'caribou.textSize': 'xs' }, 'xs'],
  ['smaller', { 'caribou.textSize': 'sm' }, 'sm'],
  ['default', { 'caribou.textSize': 'md' }, 'md'],
  ['larger', { 'caribou.textSize': 'lg' }, 'lg'],
  ['largest', { 'caribou.textSize': 'xl' }, 'xl'],
  ['unknown value', { 'caribou.textSize': 'huge' }, 'md'],
  ['empty value', { 'caribou.textSize': '' }, 'md'],
  ['two steps in one value', { 'caribou.textSize': 'xs sm' }, 'md'],
  ['other case', { 'caribou.textSize': 'XL' }, 'md'],
  ['JSON, not the plain id', { 'caribou.textSize': '"xl"' }, 'md'],
  ['an inherited name', { 'caribou.textSize': 'constructor' }, 'md'],
  ['an account is active: still the device value', {
    'caribou.activeUserKey': JSON.stringify('alice@example.social'),
    'caribou.users': JSON.stringify([['alice@example.social', {}]]),
    'caribou.prefs.alice@example.social': JSON.stringify({ textSize: 'xs' }),
    'caribou.textSize': 'lg',
  }, 'lg'],
  ['storage blocked', null, 'md'],
]

function storage(store: Store | null): Storage {
  if (!store) {
    return { getItem: () => { throw new DOMException('blocked', 'SecurityError') } } as unknown as Storage
  }
  return { getItem: (k: string) => (k in store ? store[k] : null) } as unknown as Storage
}

const attr = (doc: Document) => doc.documentElement.getAttribute('data-text-size')
const expectedAttr = (size: TextSize) => (size === 'md' ? null : size)

// Runs the head script on a document whose parser stopped in the head.
function runHeadScript(local: Store | null, start: string | null = null) {
  const body = TEXT_SIZE_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
  const doc = document.implementation.createHTMLDocument('')
  doc.body.remove()
  if (start) doc.documentElement.setAttribute('data-text-size', start)
  new Function('localStorage', 'document', body)(storage(local), doc)
  return doc
}

describe('textSizeFromStorage (client)', () => {
  it.each(CASES)('%s', (_name, local, expected) => {
    expect(textSizeFromStorage(storage(local))).toBe(expected)
  })
})

describe('TEXT_SIZE_HEAD (inline script before first paint)', () => {
  it.each(CASES)('%s', (_name, local, expected) => {
    expect(attr(runHeadScript(local))).toBe(expectedAttr(expected))
  })

  it('removes a stale attribute for the default', () => {
    expect(attr(runHeadScript({}, 'xl'))).toBeNull()
  })

  it('is one plain inline script with no closing tag inside', () => {
    expect(TEXT_SIZE_HEAD.startsWith('<script>')).toBe(true)
    expect(TEXT_SIZE_HEAD.indexOf('</script>')).toBe(TEXT_SIZE_HEAD.length - '</script>'.length)
    expect(TEXT_SIZE_SCRIPT).not.toContain('\n')
  })

  it('reads nothing but the text size key', () => {
    expect(TEXT_SIZE_SCRIPT).not.toMatch(/activeUserKey|caribou\.users|caribou\.prefs|location/)
  })
})

describe('textSizeOf', () => {
  it('keeps the five steps and turns anything else into the default', () => {
    for (const s of TEXT_SIZES) expect(textSizeOf(s)).toBe(s)
    for (const v of [null, undefined, 3, {}, 'md ', 'default']) expect(textSizeOf(v)).toBe(DEFAULT_TEXT_SIZE)
  })

  it('has five steps with the default in the middle', () => {
    expect(TEXT_SIZES).toHaveLength(5)
    expect(TEXT_SIZES[2]).toBe(DEFAULT_TEXT_SIZE)
  })
})

// The `html[data-text-size]` rules in a stylesheet, as [id, percent].
const sizeRules = (css: string) =>
  [...css.matchAll(/html\[data-text-size="(\w+)"\]\s*\{\s*font-size:\s*([\d.]+)%;\s*\}/g)]
    .map((m) => [m[1], Number(m[2])])

describe('the step percentages', () => {
  // Smaller to larger, in percent of the browser's own size; the default
  // has no rule at all, so the root keeps the browser's size.
  it('tokens.css maps each step but the default to its percentage', () => {
    expect(sizeRules(TOKENS_CSS)).toEqual([['xs', 87.5], ['sm', 93.75], ['lg', 112.5], ['xl', 125]])
    expect(sizeRules(TOKENS_CSS)).toEqual(Object.entries(TEXT_SIZE_PERCENT))
    expect(TOKENS_CSS).not.toMatch(/data-text-size="md"/)
    expect(TOKENS_CSS).not.toMatch(/text-size-adjust/)
  })

  // The sign-in pages have no tokens; they carry their own copy.
  it('the sign-in pages have the same rules as tokens.css', () => {
    expect(sizeRules(SIGNIN_FALLBACK_PAGE)).toEqual(sizeRules(TOKENS_CSS))
    expect(sizeRules(TEXT_SIZE_CSS)).toEqual(sizeRules(TOKENS_CSS))
  })
})

describe('applyTextSize', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-text-size') })

  it('sets the attribute, and removes it for the default', () => {
    applyTextSize(document, 'lg')
    expect(attr(document)).toBe('lg')
    applyTextSize(document, 'md')
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })
})

describe('the stored step', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-text-size')
    textSize.value = 'md'
    vi.restoreAllMocks()
  })

  it('reads the default when nothing is stored', () => {
    expect(currentTextSize()).toBe('md')
  })

  it('writes the plain step id and applies it', () => {
    expect(setTextSize('xs')).toBe(true)
    expect(localStorage.getItem('caribou.textSize')).toBe('xs')
    expect(currentTextSize()).toBe('xs')
    expect(textSize.value).toBe('xs')
    expect(attr(document)).toBe('xs')
  })

  it('a refused write returns false and changes nothing', () => {
    localStorage.setItem('caribou.textSize', 'lg')
    applyTextSize(document, 'lg')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(setTextSize('xs')).toBe(false)
    expect(localStorage.getItem('caribou.textSize')).toBe('lg')
    expect(attr(document)).toBe('lg')
    expect(textSize.value).toBe('md')
  })

  it('blocked storage never throws: reads give the default, writes give false', () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(currentTextSize()).toBe('md')
    expect(setTextSize('xl')).toBe(false)
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
    blocked.mockRestore()
  })
})

describe('startTextSize', () => {
  let stop: (() => void) | undefined
  afterEach(() => {
    stop?.()
    stop = undefined
    localStorage.clear()
    document.documentElement.removeAttribute('data-text-size')
    textSize.value = 'md'
  })

  const fire = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }))

  it('applies the stored step at once', () => {
    localStorage.setItem('caribou.textSize', 'xl')
    stop = startTextSize(window, document)
    expect(attr(document)).toBe('xl')
    expect(textSize.value).toBe('xl')
  })

  it('follows another tab: a change, a removal, and a clear', () => {
    stop = startTextSize(window, document)
    localStorage.setItem('caribou.textSize', 'sm')
    fire('caribou.textSize')
    expect(attr(document)).toBe('sm')

    localStorage.setItem('caribou.textSize', 'lg')
    fire('caribou.users')
    expect(attr(document)).toBe('sm')

    localStorage.removeItem('caribou.textSize')
    fire('caribou.textSize')
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)

    localStorage.setItem('caribou.textSize', 'xs')
    fire('caribou.textSize')
    localStorage.clear()
    fire(null)
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
    expect(textSize.value).toBe('md')
  })

  it('stops listening when stopped', () => {
    stop = startTextSize(window, document)
    stop()
    stop = undefined
    localStorage.setItem('caribou.textSize', 'xl')
    fire('caribou.textSize')
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })
})
