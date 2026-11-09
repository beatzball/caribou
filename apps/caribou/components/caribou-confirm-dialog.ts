import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import type { Network } from '@beatzball/caribou-mastodon-client'
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
  private cancelled = false

  /** Opens the dialog. Resolves true on confirm, false on cancel or Escape. */
  async ask(): Promise<boolean> {
    await this.updateComplete
    if (this.cancelled) return false
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

  /** Closes the dialog as if the reader had cancelled, even before it opened. */
  cancel() {
    this.cancelled = true
    this.finish(false)
  }
}

/**
 * Asks a yes-or-no question in a modal dialog and removes the dialog after.
 * The question belongs to the account that was active when it opened: if
 * the active account changes, it closes with no. Client only.
 */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const el = document.createElement('caribou-confirm-dialog') as CaribouConfirmDialog
  el.heading = opts.title
  el.message = opts.message
  el.confirmLabel = opts.confirmLabel
  document.body.appendChild(el)
  const owner = activeUserKey.peek()
  const stop = effect(() => { if (activeUserKey.value !== owner) el.cancel() })
  try {
    return await el.ask()
  } finally {
    stop()
    el.remove()
  }
}

/** Said in every Bluesky block confirm (spec 9): a block is a public record. */
export const BLUESKY_BLOCK_PUBLIC = 'Blocks on Bluesky are public. Anyone can see that you blocked this account.'

/**
 * The question every Block asks first. A Bluesky block says it is public;
 * a Mastodon block's text is as it was.
 */
export function confirmBlock(acct: string, network: Network = 'mastodon'): Promise<boolean> {
  return confirmDialog({
    title: `Block @${acct}?`,
    message: network === 'bluesky'
      ? `@${acct} will no longer be able to follow you, reply to you or quote you, and you will no longer see each other's posts. ${BLUESKY_BLOCK_PUBLIC}`
      : `@${acct} will no longer be able to follow you or see your posts, and you will no longer see theirs.`,
    confirmLabel: 'Block',
  })
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-confirm-dialog': CaribouConfirmDialog }
}
