// The text size: five steps, the middle one (`md`) the default and exactly
// the size the app had before the setting existed (issue 309). It is per
// device, not per account: one localStorage key, `caribou.textSize`, that
// holds a step id as plain text. It applies to every account and when no one
// is signed in.
//
// The step is `data-text-size` on `<html>`, and tokens.css maps each id to a
// percentage root `font-size`. Percent, not px: it scales the reader's own
// browser or system text size, and browser zoom still works. The default
// step has no attribute, so the root keeps the browser's size. Text is in
// rem, so one root value changes posts, names, the UI and the compose box.
//
// Two places apply it, with the same rules. On a full page load the inline
// script in the head (`server/lib/text-size-head.ts`) sets the attribute
// before the first paint, so the page never shows the wrong size first.
// After that, `startTextSize` (from `app-main.ts`) keeps it in step: a change
// on /settings, and a change in another tab (the `storage` event). The tests
// run both on one table of cases.
//
// `<html>` is outside every Lit template, so its attribute does not touch
// hydration.
import { signal } from '@preact/signals-core'

export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/** Smaller to larger. Keep in step with tokens.css and the head script. */
export const TEXT_SIZES: readonly TextSize[] = ['xs', 'sm', 'md', 'lg', 'xl']
export const DEFAULT_TEXT_SIZE: TextSize = 'md'
export const TEXT_SIZE_KEY = 'caribou.textSize'
export const TEXT_SIZE_ATTR = 'data-text-size'

/** The step for a stored value. The default for anything else. */
export function textSizeOf(raw: unknown): TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(raw) ? raw as TextSize : DEFAULT_TEXT_SIZE
}

/** The stored step. The default when nothing is stored or storage is blocked. */
export function textSizeFromStorage(local: Pick<Storage, 'getItem'>): TextSize {
  try {
    return textSizeOf(local.getItem(TEXT_SIZE_KEY))
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

/** Puts the step on `<html>`; the default step removes the attribute. */
export function applyTextSize(doc: Document, size: TextSize): void {
  if (size === DEFAULT_TEXT_SIZE) doc.documentElement.removeAttribute(TEXT_SIZE_ATTR)
  else doc.documentElement.setAttribute(TEXT_SIZE_ATTR, size)
}

// `window.localStorage` itself throws when storage is blocked, so reach it
// inside the try.
function readStored(win: Window = window): TextSize {
  try {
    return textSizeFromStorage(win.localStorage)
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

/** The step shown now. `startTextSize` and `setTextSize` keep it current. */
export const textSize = signal<TextSize>(DEFAULT_TEXT_SIZE)

/** The stored step, read again from storage. */
export function currentTextSize(): TextSize {
  return readStored()
}

/**
 * Saves the step and applies it to this page. False, and nothing changes,
 * when storage refused the write.
 */
export function setTextSize(size: TextSize): boolean {
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, size)
  } catch {
    return false
  }
  textSize.value = size
  applyTextSize(document, size)
  return true
}

/**
 * Applies the stored step now, and again whenever another tab changes it.
 * Returns a stop function.
 */
export function startTextSize(win: Window, doc: Document): () => void {
  const sync = () => {
    textSize.value = readStored(win)
    applyTextSize(doc, textSize.value)
  }
  // `key` is null when another tab cleared all of storage.
  const onStorage = (e: StorageEvent) => {
    if (e.key === TEXT_SIZE_KEY || e.key === null) sync()
  }
  sync()
  win.addEventListener('storage', onStorage)
  return () => { win.removeEventListener('storage', onStorage) }
}
