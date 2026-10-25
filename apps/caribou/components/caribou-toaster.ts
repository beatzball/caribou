import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { ICONS } from './_icons.js'

export type ToastKind = 'error' | 'info'

export interface ToastDetail {
  kind: ToastKind
  message: string
}

interface Toast extends ToastDetail {
  id: number
}

export const TOAST_TIMEOUT_MS = 5_000
// Older toasts drop off the top once the stack is this tall.
const MAX_TOASTS = 4

// Shows `caribou:toast` events from anywhere in the app:
//   window.dispatchEvent(new CustomEvent('caribou:toast',
//     { detail: { kind: 'error', message: '…' } }))
@customElement('caribou-toaster')
export class CaribouToaster extends LitElement {
  static override styles = css`
    :host {
      position: fixed; inset-inline: 0; bottom: var(--space-4); z-index: 100;
      display: flex; justify-content: center; pointer-events: none;
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
    button {
      display: inline-flex; padding: var(--space-1);
      border: 0; border-radius: var(--radius-sm); background: none;
      color: var(--fg-muted); cursor: pointer;
    }
    button:hover { color: var(--fg-0); }
    button:focus-visible { outline: 2px solid var(--accent); }
  `

  @state() private toasts: Toast[] = []
  // False on the server and for the first client render, so the server
  // HTML (nothing) equals what hydration expects. The live regions appear
  // right after mount, before any toast, so screen readers watch them.
  @state() private ready = false

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

  protected override firstUpdated() {
    this.ready = true
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
    for (const old of next.splice(0, Math.max(0, next.length - MAX_TOASTS))) this.clearTimer(old.id)
    this.toasts = next
    this.timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), TOAST_TIMEOUT_MS))
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
      <div class="toast" data-kind=${t.kind}>
        <span class="message">${t.message}</span>
        <button type="button" aria-label="Dismiss" @click=${() => this.dismiss(t.id)}>${ICONS.x}</button>
      </div>
    `)
  }

  override render() {
    if (!this.ready) return nothing
    // Two regions: errors interrupt (`alert`), everything else waits its
    // turn (`status`).
    return html`
      <div class="stack">
        <div class="stack" role="alert">${this.renderList('error')}</div>
        <div class="stack" role="status" aria-live="polite">${this.renderList('info')}</div>
      </div>
    `
  }
}
