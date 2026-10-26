import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import './caribou-icon-button.js'

export type ToastKind = 'error' | 'info'

export interface ToastDetail {
  kind: ToastKind
  message: string
}

interface Toast extends ToastDetail {
  id: number
}

// Info toasts close on their own. Errors stay until dismissed: a reader
// may need longer than any timeout to notice and read one (WCAG 2.2.1).
export const TOAST_TIMEOUT_MS = 5_000
// Past this many, the oldest toast drops off, info before errors.
const MAX_TOASTS = 4

// Shows `caribou:toast` events from anywhere in the app:
//   window.dispatchEvent(new CustomEvent('caribou:toast',
//     { detail: { kind: 'error', message: '…' } }))
@customElement('caribou-toaster')
export class CaribouToaster extends LitElement {
  static override styles = css`
    /* Clear of the iPhone home indicator, and on mobile above the fixed
       nav bar (61px with its border) so a toast never covers it. */
    :host {
      position: fixed; inset-inline: 0; z-index: 100;
      bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
      display: flex; justify-content: center; pointer-events: none;
    }
    @media (max-width: 767px) {
      :host { bottom: calc(61px + var(--space-4) + env(safe-area-inset-bottom, 0px)); }
    }
    .stack { display: flex; flex-direction: column; gap: var(--space-2); }
    .toast {
      display: flex; align-items: center; gap: var(--space-3);
      max-width: min(32rem, calc(100vw - 2 * var(--space-4)));
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--bg-2); color: var(--fg-0);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
      pointer-events: auto;
    }
    .toast[data-kind="error"] { border-color: var(--danger); }
    .message { flex: 1; }
    /* Borderless and muted: the toast's own border is the frame. */
    caribou-icon-button::part(button) {
      border: 0; background: none; color: var(--fg-muted);
    }
    caribou-icon-button::part(button):hover { color: var(--fg-0); }
  `

  @state() private toasts: Toast[] = []

  private nextId = 1
  private timers = new Map<number, ReturnType<typeof setTimeout>>()

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('caribou:toast', this.onToast)
  }

  override disconnectedCallback() {
    window.removeEventListener('caribou:toast', this.onToast)
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    this.toasts = []
    super.disconnectedCallback()
  }

  private onToast = (e: Event) => {
    const detail = (e as CustomEvent<Partial<ToastDetail> | null>).detail
    if (!detail || typeof detail.message !== 'string' || !detail.message) return
    const toast: Toast = {
      id: this.nextId++,
      kind: detail.kind === 'error' ? 'error' : 'info',
      message: detail.message,
    }
    const next = [...this.toasts, toast]
    while (next.length > MAX_TOASTS) {
      const info = next.findIndex((t) => t.kind === 'info')
      const [old] = next.splice(info === -1 ? 0 : info, 1)
      this.clearTimer(old!.id)
    }
    this.toasts = next
    if (toast.kind === 'info') {
      this.timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), TOAST_TIMEOUT_MS))
    }
  }

  private clearTimer(id: number) {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
  }

  private dismiss(id: number) {
    this.clearTimer(id)
    this.toasts = this.toasts.filter((t) => t.id !== id)
  }

  private renderList(kind: ToastKind) {
    return repeat(this.toasts.filter((t) => t.kind === kind), (t) => t.id, (t) => html`
      <div class="toast" data-kind=${t.kind} role=${kind === 'error' ? 'alert' : nothing}>
        <span class="message">${t.message}</span>
        <caribou-icon-button icon="x" label="Dismiss" @click=${() => this.dismiss(t.id)}></caribou-icon-button>
      </div>
    `)
  }

  // The server renders the empty stack too, so hydration finds the same
  // markup and the polite region is in the page before its first toast;
  // a screen reader only announces changes to a region it already knows.
  // Errors interrupt: each one is its own `alert`, added when it happens.
  // An empty `role="alert"` box would sit in every page and match any
  // lookup for the page's own alert.
  override render() {
    return html`
      <div class="stack">
        <div class="stack errors">${this.renderList('error')}</div>
        <div class="stack" role="status" aria-live="polite">${this.renderList('info')}</div>
      </div>
    `
  }
}
