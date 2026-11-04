import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toggleShortcutsHelp } from '../caribou-shortcuts-help.js'
import { SHORTCUT_GROUPS } from '../_shortcuts.js'

async function opened() {
  await new Promise((r) => setTimeout(r, 0))
  const el = document.querySelector('caribou-shortcuts-help')!
  await el.updateComplete
  return el
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { document.body.replaceChildren() })

describe('toggleShortcutsHelp', () => {
  it('opens a named modal that lists every shortcut, with Close focused', async () => {
    void toggleShortcutsHelp()
    const el = await opened()
    const dialog = el.shadowRoot!.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(el.shadowRoot!.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)!.textContent).toBe('Keyboard shortcuts')
    const labels = Array.from(el.shadowRoot!.querySelectorAll('dd')).map((d) => d.textContent)
    expect(labels).toEqual(SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.label)))
    expect(el.shadowRoot!.querySelector('dt')!.textContent).toBe('j')
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('caribou-button.close'))
  })

  it('a second call closes it and removes it, and focus goes back', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const done = toggleShortcutsHelp()
    await opened()
    await toggleShortcutsHelp()
    await done
    expect(document.querySelector('caribou-shortcuts-help')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Close closes it', async () => {
    const done = toggleShortcutsHelp()
    const el = await opened()
    el.shadowRoot!.querySelector<HTMLElement>('caribou-button.close')!.click()
    await done
    expect(document.querySelector('caribou-shortcuts-help')).toBeNull()
  })
})
