import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, addUserSession, updatePrefs, users, type UserSession } from '@beatzball/caribou-state'
import {
  SEQUENCE_MS, cardInPath, isTypingTarget, postLabel, startShortcuts, type ShortcutDeps,
} from '../_shortcuts.js'

// A stand-in for the post card: the parts the shortcuts touch. The real
// card is covered by its own tests; this keeps the test about the keys.
class FakeCard extends HTMLElement {
  status: unknown = null
  clicks: string[] = []
  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `
      <litro-link class="permalink" href="/@bob@example.net/1"><time>2h</time></litro-link>
      <div class="status-content"><p>hello   world</p></div>
      <caribou-icon-button class="reply"></caribou-icon-button>
      <caribou-icon-button class="boost"></caribou-icon-button>
      <caribou-icon-button class="favourite"></caribou-icon-button>`
    for (const ib of Array.from(root.querySelectorAll('caribou-icon-button'))) {
      const inner = ib.attachShadow({ mode: 'open' })
      inner.innerHTML = '<button></button>'
      inner.querySelector('button')!.addEventListener('click', () => this.clicks.push(ib.className))
    }
  }
}
if (!customElements.get('caribou-status-card')) customElements.define('caribou-status-card', FakeCard)

// A list in a shadow root, as every feed renders it.
class FakeList extends HTMLElement {
  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = '<ul><li><caribou-status-card></caribou-status-card></li>'
      + '<li><caribou-status-card></caribou-status-card></li>'
      + '<li><caribou-status-card hidden></caribou-status-card></li>'
      + '<li><caribou-status-card></caribou-status-card></li></ul>'
  }
}
if (!customElements.get('fake-list')) customElements.define('fake-list', FakeList)

let stop: () => void
let deps: { navigate: ReturnType<typeof vi.fn>; toggleHelp: ReturnType<typeof vi.fn>; helpOpen: () => boolean; enabled: () => boolean; now: () => number }
let clock = 0
let list: FakeList

function items(): HTMLLIElement[] {
  return Array.from(list.shadowRoot!.querySelectorAll('li'))
}
function cards(): FakeCard[] {
  return Array.from(list.shadowRoot!.querySelectorAll('caribou-status-card')) as FakeCard[]
}
function deepActive(): Element | null {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = deepActive() ?? document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

beforeEach(() => {
  const outlet = document.createElement('litro-outlet')
  list = document.createElement('fake-list') as FakeList
  outlet.append(list)
  document.body.append(outlet)
  clock = 0
  deps = {
    navigate: vi.fn(), toggleHelp: vi.fn(), helpOpen: () => false, enabled: () => true, now: () => clock,
  }
  stop = startShortcuts(window, document, {
    navigate: (p) => deps.navigate(p),
    toggleHelp: () => deps.toggleHelp(),
    helpOpen: () => deps.helpOpen(),
    enabled: () => deps.enabled(),
    now: () => deps.now(),
  } satisfies Partial<ShortcutDeps>)
})

afterEach(() => {
  stop()
  document.body.replaceChildren()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
})

describe('j and k', () => {
  it('j focuses the first post, then the next one, skipping a hidden card', () => {
    press('j')
    expect(deepActive()).toBe(items()[0])
    press('j')
    expect(deepActive()).toBe(items()[1])
    press('j')
    expect(deepActive()).toBe(items()[3])
    // The last post stays.
    press('j')
    expect(deepActive()).toBe(items()[3])
  })

  it('k goes back', () => {
    press('j'); press('j')
    press('k')
    expect(deepActive()).toBe(items()[0])
    press('k')
    expect(deepActive()).toBe(items()[0])
  })

  it('gives the item a name, a focus marker and tabindex -1', () => {
    press('j')
    const li = items()[0]!
    expect(li.getAttribute('tabindex')).toBe('-1')
    expect(li.hasAttribute('data-caribou-post')).toBe(true)
    expect(li.getAttribute('aria-label')).toContain('hello world')
  })

  it('goes on from a post focused some other way (a control inside it)', () => {
    const second = cards()[1]!
    const reply = second.shadowRoot!.querySelector('caribou-icon-button.reply')!.shadowRoot!.querySelector('button')!
    press('j', {}, reply)
    expect(deepActive()).toBe(items()[3])
  })
})

describe('actions on the focused post', () => {
  it('f, b and r press favourite, boost and reply on that post only', () => {
    press('j'); press('j')
    press('f'); press('b'); press('r')
    expect(cards()[1]!.clicks).toEqual(['favourite', 'boost', 'reply'])
    expect(cards()[0]!.clicks).toEqual([])
  })

  it('does nothing with no post focused', () => {
    const e = press('f')
    expect(e.defaultPrevented).toBe(false)
    expect(cards().every((c) => c.clicks.length === 0)).toBe(true)
  })

  it('o and Enter open the post', () => {
    press('j')
    press('o')
    press('Enter')
    expect(deps.navigate).toHaveBeenCalledTimes(2)
    expect(deps.navigate).toHaveBeenCalledWith('/@bob@example.net/1')
  })

  it('Enter on a control inside the post is the control\'s', () => {
    const fav = cards()[0]!.shadowRoot!.querySelector('caribou-icon-button.favourite')!.shadowRoot!.querySelector('button')!
    const e = press('Enter', {}, fav)
    expect(e.defaultPrevented).toBe(false)
    expect(deps.navigate).not.toHaveBeenCalled()
  })
})

describe('other keys', () => {
  it('n asks for the compose dialog', () => {
    const heard = vi.fn()
    window.addEventListener('caribou:compose', heard)
    press('n')
    window.removeEventListener('caribou:compose', heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('g then h, n, l or s goes to that page', () => {
    for (const [k, path] of [['h', '/home'], ['n', '/notifications'], ['l', '/lists'], ['s', '/search']] as const) {
      press('g'); press(k)
      expect(deps.navigate).toHaveBeenLastCalledWith(path)
    }
  })

  it('g then n goes to notifications and does not open compose', () => {
    const heard = vi.fn()
    window.addEventListener('caribou:compose', heard)
    press('g'); press('n')
    window.removeEventListener('caribou:compose', heard)
    expect(heard).not.toHaveBeenCalled()
  })

  it('a g that waited too long is forgotten', () => {
    press('g')
    clock += SEQUENCE_MS + 1
    press('h')
    expect(deps.navigate).not.toHaveBeenCalled()
  })

  it('/ focuses a search box', () => {
    const input = document.createElement('input')
    input.type = 'search'
    document.body.append(input)
    press('/')
    expect(document.activeElement).toBe(input)
  })

  it('? toggles the help sheet; while it is open only ? answers', () => {
    press('?')
    expect(deps.toggleHelp).toHaveBeenCalledTimes(1)
    deps.helpOpen = () => true
    press('j')
    expect(deepActive()).not.toBe(items()[0])
    press('?')
    expect(deps.toggleHelp).toHaveBeenCalledTimes(2)
  })

  it('caribou:shortcuts-help opens the help sheet', () => {
    window.dispatchEvent(new CustomEvent('caribou:shortcuts-help'))
    expect(deps.toggleHelp).toHaveBeenCalledTimes(1)
  })
})

describe('guards', () => {
  it('ignores keys typed into a text field, a textarea or contenteditable', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(input, area, editable)
    for (const el of [input, area, editable]) {
      press('j', {}, el)
      press('?', {}, el)
    }
    expect(deepActive()).not.toBe(items()[0])
    expect(deps.toggleHelp).not.toHaveBeenCalled()
  })

  it('ignores Ctrl, Meta and Alt', () => {
    press('j', { ctrlKey: true })
    press('j', { metaKey: true })
    press('j', { altKey: true })
    expect(deepActive()).not.toBe(items()[0])
  })

  it('ignores IME composition', () => {
    press('j', { isComposing: true })
    press('j', { keyCode: 229 })
    expect(deepActive()).not.toBe(items()[0])
  })

  it('ignores a key an earlier listener used (Vimium, a dialog)', () => {
    const first = (e: Event) => e.preventDefault()
    document.body.addEventListener('keydown', first)
    press('j', {}, document.body)
    document.body.removeEventListener('keydown', first)
    expect(deepActive()).not.toBe(items()[0])
  })

  it('ignores keys while any dialog is open, even in a shadow root', () => {
    const host = document.createElement('div')
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    host.attachShadow({ mode: 'open' }).append(dialog)
    document.body.append(host)
    press('j')
    press('?')
    expect(deepActive()).not.toBe(items()[0])
    expect(deps.toggleHelp).not.toHaveBeenCalled()
  })

  it('ignores keys while the loading screen holds the page', () => {
    document.body.inert = true
    press('j')
    document.body.inert = false
    expect(deepActive()).not.toBe(items()[0])
  })

  it('does nothing when the setting is off for the active account', () => {
    stop()
    stop = startShortcuts(window, document, { navigate: deps.navigate as never })
    addUserSession({
      userKey: 'alice@example.social', server: 'example.social', token: 'T', vapidKey: '', createdAt: 1,
    } as unknown as UserSession)
    updatePrefs(activeUserKey.peek()!, { shortcuts: false })
    press('j')
    press('g'); press('h')
    expect(deepActive()).not.toBe(items()[0])
    expect(deps.navigate).not.toHaveBeenCalled()
    updatePrefs(activeUserKey.peek()!, { shortcuts: true })
    press('j')
    expect(deepActive()).toBe(items()[0])
  })
})

describe('helpers', () => {
  it('isTypingTarget knows text fields', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
    const box = document.createElement('div')
    box.setAttribute('role', 'textbox')
    expect(isTypingTarget(box)).toBe(true)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
  })

  it('cardInPath finds the card from its li', () => {
    const li = items()[1]!
    expect(cardInPath([li])).toBe(cards()[1])
    expect(cardInPath([document.body])).toBeNull()
  })

  it('postLabel names the notification line, the author, a boost, the warning and the time', () => {
    const li = items()[0]!
    const line = document.createElement('p')
    line.textContent = 'Carol favourited your post'
    li.prepend(line)
    const card = cards()[0]!
    card.status = {
      account: { displayName: 'Carol', acct: 'carol' },
      reblog: { account: { displayName: 'Bob', acct: 'bob@example.net' }, spoilerText: 'spoilers' },
    }
    expect(postLabel(card)).toBe(
      'Carol favourited your post. Post by Bob @bob@example.net, boosted by Carol. Content warning: spoilers. 2h',
    )
  })
})
