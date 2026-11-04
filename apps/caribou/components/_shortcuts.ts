// Keyboard shortcuts for the whole app: one `keydown` listener on the
// window, started once from `app-main.ts`.
//
// A post is a `<caribou-status-card>` inside the current page. The item that
// takes focus is the card's `<li>` (every list renders one), or the card
// itself where there is no `<li>`. Focus is real focus, so Tab goes on from
// the post, and a screen reader hears the item's name (`postLabel`).
//
// No shortcut fires:
// - while the reader types (an input, a textarea, a select, contenteditable)
//   or composes text with an IME;
// - with Ctrl, Meta or Alt held, so browser and system keys stay theirs;
// - while a dialog or a menu is open (the help sheet answers only `?`, and
//   Esc closes it natively);
// - when an earlier listener has already used the key (`defaultPrevented`):
//   a link-hint extension such as Vimium takes its keys first, and its own
//   mode wins;
// - when the reader turned them off on /settings (`shortcuts: false` in
//   the account's prefs).
//
// Everything here runs after a key press, never during a render, so the
// server render and the first client render are untouched.

import { activeUserKey, readPrefs, shortcutsOf } from '@beatzball/caribou-state'

export interface ShortcutInfo {
  keys: string[]
  /** Several keys pressed one after the other, not together. */
  sequence?: boolean
  label: string
}

export interface ShortcutGroup {
  heading: string
  items: ShortcutInfo[]
}

/** The help sheet's list. Keep it in step with `onKey` below. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    heading: 'Posts',
    items: [
      { keys: ['j'], label: 'Next post' },
      { keys: ['k'], label: 'Previous post' },
      { keys: ['o', 'Enter'], label: 'Open the post' },
      { keys: ['f'], label: 'Favourite' },
      { keys: ['b'], label: 'Boost' },
      { keys: ['r'], label: 'Reply' },
      { keys: ['n'], label: 'New post' },
    ],
  },
  {
    heading: 'Go to',
    items: [
      { keys: ['g', 'h'], sequence: true, label: 'Home' },
      { keys: ['g', 'n'], sequence: true, label: 'Notifications' },
      { keys: ['g', 'l'], sequence: true, label: 'Lists' },
      { keys: ['g', 's'], sequence: true, label: 'Search' },
      { keys: ['/'], label: 'Search box' },
    ],
  },
  {
    heading: 'Help',
    items: [
      { keys: ['?'], label: 'Show or hide this list' },
      { keys: ['Esc'], label: 'Close this list' },
    ],
  },
]

const GO: Record<string, string> = { h: '/home', n: '/notifications', l: '/lists', s: '/search' }
/** How long `g` waits for its second key. */
export const SEQUENCE_MS = 1500
const CARD = 'caribou-status-card'

/** True when keys typed at this target are text. */
export function isTypingTarget(el: EventTarget | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false
  // `closest` too: happy-dom, and some older engines, leave
  // `isContentEditable` false on an editable element.
  if (el.isContentEditable || el.closest('[contenteditable]:not([contenteditable="false"])')) return true
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true
  const role = el.getAttribute('role')
  return role === 'textbox' || role === 'combobox' || role === 'searchbox'
}

/** Every element under `root` that matches, through open shadow roots. */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out: Element[] = []
  const visit = (node: ParentNode) => {
    for (const el of Array.from(node.querySelectorAll('*'))) {
      if (el.matches(selector)) out.push(el)
      if (el.shadowRoot) visit(el.shadowRoot)
    }
  }
  visit(root)
  return out
}

function popoverOpen(el: Element): boolean {
  try {
    return el.matches(':popover-open')
  } catch {
    return false
  }
}

/** A dialog or a menu is open, and the page behind it is not the reader's. */
function blocked(doc: Document, path: EventTarget[]): boolean {
  if (doc.body?.inert) return true // the loading screen
  for (const node of path) {
    if (node instanceof HTMLDialogElement && node.open) return true
    if (node instanceof Element && popoverOpen(node)) return true
  }
  return deepQueryAll(doc, 'dialog[open]').length > 0
}

function isVisible(el: Element): boolean {
  if (el.hasAttribute('hidden')) return false
  const check = (el as Element & { checkVisibility?: () => boolean }).checkVisibility
  return check ? check.call(el) : true
}

/** The posts of the page, top to bottom. */
export function postsOf(doc: Document): HTMLElement[] {
  const root = doc.querySelector('litro-outlet') ?? doc.body
  return (deepQueryAll(root, CARD) as HTMLElement[])
    .filter(isVisible)
    .map((card) => ({ card, top: card.getBoundingClientRect().top }))
    // A stable sort: where layout gives no positions, the DOM order stays.
    .sort((a, b) => a.top - b.top)
    .map((p) => p.card)
}

/** The element that takes focus for a card: its `<li>`, else the card. */
export function itemOf(card: HTMLElement): HTMLElement {
  const parent = card.parentElement
  return parent instanceof HTMLLIElement ? parent : card
}

/** The card the event came from: focus is on its item or inside it. */
export function cardInPath(path: EventTarget[]): HTMLElement | null {
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue
    if (node.localName === CARD) return node
    if (node instanceof HTMLLIElement) {
      const card = Array.from(node.children).find((c) => c.localName === CARD)
      if (card) return card as HTMLElement
    }
  }
  return null
}

function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

interface CardStatus {
  account?: { displayName?: string; username?: string; acct?: string }
  reblog?: CardStatus | null
  spoilerText?: string
}

/**
 * The name a screen reader hears when the post takes focus: the
 * notification line when there is one, the author, the warning or the
 * start of the text, and the time.
 */
export function postLabel(card: HTMLElement): string {
  const status = (card as HTMLElement & { status?: CardStatus | null }).status
  const shown = status?.reblog ?? status
  const root = card.shadowRoot
  const parts: string[] = []
  const item = itemOf(card)
  if (item !== card) {
    const line = squash(Array.from(item.children)
      .filter((c) => c !== card)
      .map((c) => c.textContent)
      .join(' '))
    if (line) parts.push(line)
  }
  if (shown?.account) {
    const name = shown.account.displayName || shown.account.username || ''
    const boost = status?.reblog && status.account
      ? `, boosted by ${status.account.displayName || status.account.username}`
      : ''
    parts.push(`Post by ${name} @${shown.account.acct ?? ''}${boost}`)
  }
  if (shown?.spoilerText) {
    parts.push(`Content warning: ${squash(shown.spoilerText)}`)
  } else {
    const text = squash(root?.querySelector('.status-content')?.textContent)
    if (text) parts.push(text.length > 140 ? `${text.slice(0, 140)}…` : text)
  }
  const time = squash(root?.querySelector('time')?.textContent)
  if (time) parts.push(time)
  return parts.join('. ')
}

// The focus ring. The item lives in another element's shadow root, which
// a document style does not reach, so the rule is adopted into that root.
let ring: CSSStyleSheet | null = null
function addRing(root: Node) {
  if (!(root instanceof ShadowRoot) || typeof CSSStyleSheet === 'undefined') return
  try {
    if (!ring) {
      ring = new CSSStyleSheet()
      ring.replaceSync(`
        [data-caribou-post] { scroll-margin-block: var(--space-6); }
        [data-caribou-post]:focus { outline: none; }
        [data-caribou-post]:focus-visible {
          outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--radius-md);
        }`)
    }
    if (!root.adoptedStyleSheets.includes(ring)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, ring]
    }
  } catch {
    // No constructable style sheets: the browser's own ring shows.
  }
}

/** Gives a post focus, names it, and scrolls it into view. */
export function focusPost(card: HTMLElement): HTMLElement {
  const item = itemOf(card)
  addRing(item.getRootNode())
  item.setAttribute('data-caribou-post', '')
  if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '-1')
  item.setAttribute('aria-label', postLabel(card))
  item.focus({ preventScroll: true })
  item.scrollIntoView?.({ block: 'nearest' })
  return item
}

/** The post after (or before) `current`; with none, the first one on screen. */
export function stepFrom(posts: HTMLElement[], current: HTMLElement | null, by: 1 | -1): HTMLElement | null {
  const at = current ? posts.indexOf(current) : -1
  if (at >= 0) return posts[at + by] ?? null
  return posts.find((p) => p.getBoundingClientRect().bottom > 0) ?? posts[0] ?? null
}

/** Clicks the real button inside one of the card's action controls. */
function pressAction(card: HTMLElement, cls: string): boolean {
  const control = card.shadowRoot?.querySelector(`caribou-icon-button.${cls}`)
  const button = control?.shadowRoot?.querySelector('button')
  if (!button) return false
  button.click()
  return true
}

function permalinkOf(card: HTMLElement): string | null {
  return card.shadowRoot?.querySelector('litro-link.permalink')?.getAttribute('href') ?? null
}

export interface ShortcutDeps {
  navigate: (path: string) => void
  toggleHelp: () => void
  helpOpen: () => boolean
  enabled: () => boolean
  now: () => number
}

function defaultNavigate(path: string) {
  void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(path))
}

function defaultEnabled(): boolean {
  const key = activeUserKey.peek()
  return key ? shortcutsOf(readPrefs(key)) : true
}

function defaultToggleHelp() {
  void import('./caribou-shortcuts-help.js').then(({ toggleShortcutsHelp }) => toggleShortcutsHelp())
}

function defaultHelpOpen(): boolean {
  return document.querySelector('caribou-shortcuts-help') !== null
}

function searchInput(doc: Document): HTMLInputElement | null {
  const inputs = deepQueryAll(doc, 'input[type="search"]') as HTMLInputElement[]
  // The search page's own box first, then the right rail's.
  return inputs.find((i) => i.id === 'search-q' && isVisible(i))
    ?? inputs.find(isVisible)
    ?? null
}

/**
 * Starts the shortcuts. Returns a function that stops them. Client only.
 */
export function startShortcuts(win: Window, doc: Document, over: Partial<ShortcutDeps> = {}): () => void {
  const deps: ShortcutDeps = {
    navigate: defaultNavigate,
    toggleHelp: defaultToggleHelp,
    helpOpen: defaultHelpOpen,
    enabled: defaultEnabled,
    now: () => Date.now(),
    ...over,
  }
  let gAt = -Infinity

  const focusSearch = () => {
    const box = searchInput(doc)
    if (box) {
      box.focus()
      box.select()
      return
    }
    deps.navigate('/search')
    // The search page renders after the route loads; focus its box then.
    let tries = 0
    const retry = () => {
      const next = searchInput(doc)
      if (next) next.focus()
      else if (++tries < 30) win.setTimeout(retry, 100)
    }
    win.setTimeout(retry, 100)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.isComposing || e.keyCode === 229) return
    const path = e.composedPath()
    if (isTypingTarget(path[0])) return
    if (!deps.enabled()) return

    if (deps.helpOpen()) {
      // Esc is the dialog's own; `?` closes it too.
      if (e.key === '?') {
        e.preventDefault()
        deps.toggleHelp()
      }
      return
    }
    if (blocked(doc, path)) return

    const card = cardInPath(path)
    const now = deps.now()
    const sequence = now - gAt <= SEQUENCE_MS
    gAt = -Infinity
    if (sequence) {
      const to = GO[e.key]
      if (to) {
        e.preventDefault()
        deps.navigate(to)
      }
      return
    }

    switch (e.key) {
      case 'g':
        gAt = now
        e.preventDefault()
        return
      case 'j':
      case 'k': {
        const next = stepFrom(postsOf(doc), card, e.key === 'j' ? 1 : -1)
        if (!next) return
        e.preventDefault()
        focusPost(next)
        return
      }
      case 'o':
      case 'Enter': {
        // Enter on a link or a button inside the post is theirs.
        if (!card || (e.key === 'Enter' && path[0] !== itemOf(card))) return
        const href = permalinkOf(card)
        if (!href) return
        e.preventDefault()
        deps.navigate(href)
        return
      }
      case 'f':
      case 'b':
      case 'r': {
        if (!card) return
        const cls = e.key === 'f' ? 'favourite' : e.key === 'b' ? 'boost' : 'reply'
        if (pressAction(card, cls)) e.preventDefault()
        return
      }
      case 'n':
        e.preventDefault()
        win.dispatchEvent(new CustomEvent('caribou:compose'))
        return
      case '/':
        e.preventDefault()
        focusSearch()
        return
      case '?':
        e.preventDefault()
        deps.toggleHelp()
        return
    }
  }

  const onHelp = () => deps.toggleHelp()
  win.addEventListener('keydown', onKey)
  win.addEventListener('caribou:shortcuts-help', onHelp)
  return () => {
    win.removeEventListener('keydown', onKey)
    win.removeEventListener('caribou:shortcuts-help', onHelp)
  }
}
