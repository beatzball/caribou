import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import type { ListInput, List, ListRepliesPolicy } from '@beatzball/caribou-mastodon-client'
import { activeUserKey } from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'

export interface ListDialogOptions {
  /** The dialog's heading, such as "New list" or "Edit list". */
  title: string
  /** The submit button's text: "Create" or "Save". */
  submitLabel: string
  /** The list as it is now, when editing one. */
  initial?: Pick<List, 'title' | 'repliesPolicy'> & { exclusive?: boolean }
  /** Whether to offer `exclusive` (the server sends it on its lists: 4.2+). */
  exclusive: boolean
}

const POLICIES: { value: ListRepliesPolicy; label: string }[] = [
  { value: 'list', label: 'Members of the list' },
  { value: 'followed', label: 'Any account you follow' },
  { value: 'none', label: 'No one' },
]

// A modal form for a list's title, its replies policy and, on a server
// that has it, whether its members leave the home timeline. A native
// `<dialog>`: focus stays inside, Escape cancels, and focus goes back to
// what opened it.
@customElement('caribou-list-dialog')
export class CaribouListDialog extends LitElement {
  static override styles = [boxReset, css`
    dialog {
      inline-size: min(28rem, calc(100vw - 2 * var(--space-4)));
      padding: var(--space-4); color: var(--fg-0); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    h2 { margin: 0 0 var(--space-3); font-size: 1.125rem; }
    label.field { display: block; margin-bottom: var(--space-1); color: var(--fg-1); }
    input[type="text"] {
      inline-size: 100%; padding: var(--space-2); font: inherit; color: var(--fg-0);
      background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    input[type="text"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    fieldset { margin: var(--space-3) 0 0; padding: 0; border: 0; }
    legend { padding: 0; margin-bottom: var(--space-1); color: var(--fg-1); }
    .option { display: flex; align-items: center; gap: var(--space-2); min-block-size: 2rem; }
    input[type="radio"], input[type="checkbox"] { margin: 0; accent-color: var(--accent); inline-size: 18px; block-size: 18px; }
    .hint { margin: var(--space-1) 0 0; color: var(--fg-muted); font-size: 0.875rem; }
    .error { margin: var(--space-1) 0 0; color: var(--danger); }
    .buttons { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-4); }
  `]

  @property() heading = ''
  @property({ attribute: 'submit-label' }) submitLabel = ''
  @property({ type: Boolean }) exclusiveSupported = false
  @property({ attribute: false }) initial: ListDialogOptions['initial'] | null = null

  @state() private titleText = ''
  @state() private policy: ListRepliesPolicy = 'list'
  @state() private exclusive = false
  @state() private empty = false

  private resolve: ((input: ListInput | null) => void) | null = null
  private cancelled = false

  /** Opens the dialog. Resolves to the fields, or null on Cancel or Escape. */
  async ask(): Promise<ListInput | null> {
    this.titleText = this.initial?.title ?? ''
    this.policy = this.initial?.repliesPolicy ?? 'list'
    this.exclusive = this.initial?.exclusive ?? false
    await this.updateComplete
    if (this.cancelled) return null
    const dialog = this.renderRoot.querySelector('dialog')!
    return new Promise((resolve) => {
      this.resolve = resolve
      dialog.showModal()
      this.renderRoot.querySelector<HTMLInputElement>('#title')?.focus()
    })
  }

  private finish(input: ListInput | null) {
    const resolve = this.resolve
    this.resolve = null
    this.renderRoot.querySelector('dialog')?.close()
    resolve?.(input)
  }

  /** Closes the dialog as if the reader had cancelled, even before it opened. */
  cancel() {
    this.cancelled = true
    this.finish(null)
  }

  private onSubmit = (e: Event) => {
    e.preventDefault()
    const title = this.titleText.trim()
    if (!title) {
      this.empty = true
      this.renderRoot.querySelector<HTMLInputElement>('#title')?.focus()
      return
    }
    this.finish({
      title, repliesPolicy: this.policy,
      ...(this.exclusiveSupported ? { exclusive: this.exclusive } : {}),
    })
  }

  private onInput = (e: Event) => {
    this.titleText = (e.target as HTMLInputElement).value
    if (this.titleText.trim()) this.empty = false
  }

  override render() {
    return html`<dialog aria-labelledby="h" @close=${() => this.finish(null)}>
      <form @submit=${this.onSubmit} novalidate>
        <h2 id="h">${this.heading}</h2>
        <label class="field" for="title">Title</label>
        <input id="title" type="text" autocomplete="off" maxlength="100" .value=${this.titleText}
          aria-invalid=${this.empty ? 'true' : 'false'} aria-describedby=${this.empty ? 'title-error' : nothing}
          @input=${this.onInput} />
        ${this.empty ? html`<p id="title-error" class="error">Give the list a title.</p>` : nothing}
        <fieldset>
          <legend>Show replies to</legend>
          ${POLICIES.map((p) => html`<label class="option">
            <input type="radio" name="policy" value=${p.value} .checked=${this.policy === p.value}
              @change=${() => { this.policy = p.value }} />${p.label}</label>`)}
        </fieldset>
        ${this.exclusiveSupported ? html`<fieldset>
          <label class="option"><input id="exclusive" type="checkbox" .checked=${this.exclusive}
            aria-describedby="exclusive-hint"
            @change=${(e: Event) => { this.exclusive = (e.target as HTMLInputElement).checked }} />Hide these posts from Home</label>
          <p id="exclusive-hint" class="hint">Posts by the members show in this list only.</p>
        </fieldset>` : nothing}
        <div class="buttons">
          <caribou-button class="cancel" variant="secondary" @click=${() => this.finish(null)}>Cancel</caribou-button>
          <caribou-button class="submit" type="submit" variant="primary">${this.submitLabel}</caribou-button>
        </div>
      </form>
    </dialog>`
  }
}

/**
 * Asks for a list's fields in a modal form and removes the form after.
 * Resolves to null on Cancel, on Escape, or when the active account changes
 * while it is open. Client only.
 */
export async function listDialog(opts: ListDialogOptions): Promise<ListInput | null> {
  const el = document.createElement('caribou-list-dialog') as CaribouListDialog
  el.heading = opts.title
  el.submitLabel = opts.submitLabel
  el.exclusiveSupported = opts.exclusive
  el.initial = opts.initial ?? null
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

declare global {
  interface HTMLElementTagNameMap { 'caribou-list-dialog': CaribouListDialog }
}
