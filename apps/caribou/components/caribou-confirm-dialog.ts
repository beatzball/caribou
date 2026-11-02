import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'

export interface ConfirmOptions {
  title: string
  message: string
  /** The confirm button's text: the action, such as "Block". */
  confirmLabel: string
}

// A modal question with two answers. The native `<dialog>` keeps focus
// inside, closes on Escape, and gives focus back to what had it when it
// closes. Cancel has focus first, so Enter does not confirm by accident.
//
//   if (await confirmDialog({ title, message, confirmLabel: 'Block' })) …
@customElement('caribou-confirm-dialog')
export class CaribouConfirmDialog extends LitElement {
  static override styles = [boxReset, css`
    dialog {
      max-inline-size: min(28rem, calc(100vw - 2 * var(--space-4)));
      padding: var(--space-4); color: var(--fg-0); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    h2 { margin: 0 0 var(--space-2); font-size: 1.125rem; }
    p { margin: 0 0 var(--space-4); color: var(--fg-1); }
    .buttons { display: flex; justify-content: flex-end; gap: var(--space-2); }
  `]

  @property() heading = ''
  @property() message = ''
  @property({ attribute: 'confirm-label' }) confirmLabel = ''

  private resolve: ((ok: boolean) => void) | null = null

  /** Opens the dialog. Resolves true on confirm, false on cancel or Escape. */
  async ask(): Promise<boolean> {
    await this.updateComplete
    const dialog = this.renderRoot.querySelector('dialog')!
    return new Promise((resolve) => {
      this.resolve = resolve
      dialog.showModal()
      this.renderRoot.querySelector<HTMLElement>('caribou-button.cancel')?.focus()
    })
  }

  private finish(ok: boolean) {
    const resolve = this.resolve
    this.resolve = null
    this.renderRoot.querySelector('dialog')?.close()
    resolve?.(ok)
  }

  private onCancel = () => this.finish(false)
  private onConfirm = () => this.finish(true)
  // Escape closes the dialog itself; `close` then answers no.
  private onClose = () => this.finish(false)

  override render() {
    return html`<dialog aria-labelledby="h" aria-describedby="m" @close=${this.onClose}>
      <h2 id="h">${this.heading}</h2>
      <p id="m">${this.message}</p>
      <div class="buttons">
        <caribou-button class="cancel" variant="secondary" @click=${this.onCancel}>Cancel</caribou-button>
        <caribou-button class="confirm" variant="danger" @click=${this.onConfirm}>${this.confirmLabel}</caribou-button>
      </div>
    </dialog>`
  }
}

/**
 * Asks a yes-or-no question in a modal dialog and removes the dialog after.
 * Client only.
 */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const el = document.createElement('caribou-confirm-dialog') as CaribouConfirmDialog
  el.heading = opts.title
  el.message = opts.message
  el.confirmLabel = opts.confirmLabel
  document.body.appendChild(el)
  try {
    return await el.ask()
  } finally {
    el.remove()
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-confirm-dialog': CaribouConfirmDialog }
}
