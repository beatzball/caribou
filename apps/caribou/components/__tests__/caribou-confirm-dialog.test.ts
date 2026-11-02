import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { confirmDialog, type CaribouConfirmDialog } from '../caribou-confirm-dialog.js'

const OPTS = { title: 'Block @bob?', message: 'Are you sure?', confirmLabel: 'Block' }

async function opened(): Promise<CaribouConfirmDialog> {
  await new Promise((r) => setTimeout(r, 0))
  const el = document.querySelector('caribou-confirm-dialog')!
  await el.updateComplete
  return el
}

const part = (el: CaribouConfirmDialog, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)!

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
})
afterEach(() => { document.body.replaceChildren() })

describe('confirmDialog', () => {
  it('opens a modal named by its title and described by its message, with Cancel focused', async () => {
    const answer = confirmDialog(OPTS)
    const el = await opened()
    const dialog = part(el, 'dialog') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(part(el, `#${dialog.getAttribute('aria-labelledby')}`).textContent).toBe('Block @bob?')
    expect(part(el, `#${dialog.getAttribute('aria-describedby')}`).textContent).toBe('Are you sure?')
    expect(part(el, 'caribou-button.confirm').textContent).toBe('Block')
    expect(el.shadowRoot!.activeElement).toBe(part(el, 'caribou-button.cancel'))
    part(el, 'caribou-button.cancel').click()
    expect(await answer).toBe(false)
  })

  it('resolves true on confirm and removes itself', async () => {
    const answer = confirmDialog(OPTS)
    const el = await opened()
    part(el, 'caribou-button.confirm').click()
    expect(await answer).toBe(true)
    expect(document.querySelector('caribou-confirm-dialog')).toBeNull()
  })

  it('resolves false when the dialog closes another way (Escape)', async () => {
    const answer = confirmDialog(OPTS)
    const el = await opened()
    part(el, 'dialog').dispatchEvent(new Event('close'))
    expect(await answer).toBe(false)
  })
})
