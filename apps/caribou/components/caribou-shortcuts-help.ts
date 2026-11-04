import { LitElement, html, css, nothing } from 'lit'
import { customElement } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import { SHORTCUT_GROUPS, type ShortcutInfo } from './_shortcuts.js'
import './caribou-button.js'

// The list of keyboard shortcuts, in a modal dialog. `?` opens it
// (`components/_shortcuts.ts`), and so does Keyboard shortcuts in the right
// rail and on /settings. The native `<dialog>` keeps focus inside and closes
// on Escape; `?` closes it too. Client only.
@customElement('caribou-shortcuts-help')
export class CaribouShortcutsHelp extends LitElement {
  static override styles = [boxReset, css`
    dialog {
      inline-size: min(28rem, calc(100vw - 2 * var(--space-4)));
      max-block-size: calc(100dvh - 2 * var(--space-4));
      padding: 0; color: var(--fg-0); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    header {
      display: flex; justify-content: space-between; align-items: center; gap: var(--space-2);
      padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border);
    }
    h2 { margin: 0; font-size: 1.125rem; }
    .body { padding: var(--space-2) var(--space-4) var(--space-4); }
    h3 { margin: var(--space-3) 0 var(--space-1); font-size: 0.875rem; color: var(--fg-muted); }
    dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-4); align-items: center; }
    dt { white-space: nowrap; color: var(--fg-muted); }
    dd { margin: 0; }
    kbd {
      display: inline-block; min-inline-size: 1.5em; padding: 0 var(--space-1);
      font-family: var(--font-mono); font-size: 0.875rem; text-align: center; color: var(--fg-0);
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-1);
    }
    .note { margin: var(--space-4) 0 0; color: var(--fg-muted); font-size: 0.875rem; }
  `]

  private resolve: (() => void) | null = null

  /** Opens the dialog; resolves when it closes. */
  async open(): Promise<void> {
    await this.updateComplete
    const dialog = this.renderRoot.querySelector('dialog')!
    return new Promise((resolve) => {
      this.resolve = resolve
      dialog.showModal()
      this.renderRoot.querySelector<HTMLElement>('caribou-button.close')?.focus()
    })
  }

  close() {
    this.renderRoot.querySelector('dialog')?.close()
    this.finish()
  }

  private finish = () => {
    const resolve = this.resolve
    this.resolve = null
    resolve?.()
  }

  private renderKeys(s: ShortcutInfo) {
    // "g then h" for a sequence, "o or Enter" for a choice.
    const joiner = s.sequence ? ' then ' : ' or '
    // Each in an element: happy-dom drops a top-level child binding (README, Tests).
    return s.keys.map((k, i) => html`<span>${i > 0 ? joiner : nothing}<kbd>${k}</kbd></span>`)
  }

  override render() {
    return html`<dialog aria-labelledby="h" @close=${this.finish}>
      <header>
        <h2 id="h">Keyboard shortcuts</h2>
        <caribou-button class="close" variant="secondary" @click=${() => this.close()}>Close</caribou-button>
      </header>
      <div class="body">
        ${SHORTCUT_GROUPS.map((g) => html`<section>
          <h3>${g.heading}</h3>
          <dl>${g.items.map((s) => html`<dt>${this.renderKeys(s)}</dt><dd>${s.label}</dd>`)}</dl>
        </section>`)}
        <p class="note">Shortcuts do not work while you type. Turn them off in Settings.</p>
      </div>
    </dialog>`
  }
}

let current: CaribouShortcutsHelp | null = null

/** Opens the help sheet, or closes it when it is open. Client only. */
export async function toggleShortcutsHelp(): Promise<void> {
  if (current?.isConnected) {
    current.close()
    return
  }
  // Focus goes back to what had it, which may sit in a shadow root; the
  // dialog element goes away, so give it back by hand.
  let opener: Element | null = document.activeElement
  while (opener?.shadowRoot?.activeElement) opener = opener.shadowRoot.activeElement
  const el = document.createElement('caribou-shortcuts-help') as CaribouShortcutsHelp
  current = el
  document.body.appendChild(el)
  try {
    await el.open()
  } finally {
    current = null
    el.remove()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-shortcuts-help': CaribouShortcutsHelp }
}
