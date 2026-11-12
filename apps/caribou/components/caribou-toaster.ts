import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import './caribou-icon-button.js'
import './caribou-button.js'

export type ToastKind = 'error' | 'info'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastDetail {
  kind: ToastKind
  message: string
  /** One button after the message, such as Undo. Running it closes the toast. */
  action?: ToastAction
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
  private workTargets: HTMLElement[] = []
  private focusVersion = 0
  private focusRoot: ShadowRoot | null = null

  private onFocus = (e: Event) => {
    this.focusVersion++
    this.rememberWork(e)
  }

  // Focusout leaves the work subtree before entering the toast. Its path
  // names the latest field even when earlier moves within that subtree
  // were retargeted to the same host and never reached the shell.
  private rememberWork = (e: Event) => {
    const path = e.composedPath()
    if (path.includes(this)) return
    const target = path[0]
    if (target instanceof HTMLElement && target !== document.body) {
      this.workTargets = [target, ...this.workTargets.filter((t) => t !== target)].slice(0, 8)
    }
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('caribou:toast', this.onToast)
    document.addEventListener('focusin', this.onFocus)
    document.addEventListener('focusout', this.rememberWork)
    // Related targets within the page can retarget to the same host, so
    // those focus events never reach document. Observe the shell too.
    const root = this.getRootNode()
    this.focusRoot = root instanceof ShadowRoot ? root : null
    this.focusRoot?.addEventListener('focusin', this.onFocus)
    this.focusRoot?.addEventListener('focusout', this.rememberWork)
  }

  override disconnectedCallback() {
    window.removeEventListener('caribou:toast', this.onToast)
    document.removeEventListener('focusin', this.onFocus)
    document.removeEventListener('focusout', this.rememberWork)
    this.focusRoot?.removeEventListener('focusin', this.onFocus)
    this.focusRoot?.removeEventListener('focusout', this.rememberWork)
    this.focusRoot = null
    this.workTargets = []
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
    const action = detail.action
    if (action && typeof action.label === 'string' && action.label && typeof action.run === 'function') {
      toast.action = { label: action.label, run: action.run }
    }
    const next = [...this.toasts, toast]
    // Past the limit the oldest plain info toast goes first, then the
    // oldest error. Two toasts are never pushed out: the one that just
    // came (a new failure always shows) and one with an action (Undo goes
    // only when it is used or dismissed). With several Undos up the stack
    // can grow past the limit rather than break either promise.
    const kept = (t: Toast) => t === toast || !!t.action
    while (next.length > MAX_TOASTS) {
      const info = next.findIndex((t) => t.kind === 'info' && !kept(t))
      const at = info !== -1 ? info : next.findIndex((t) => !kept(t))
      if (at === -1) break
      const [old] = next.splice(at, 1)
      this.clearTimer(old!.id)
    }
    const recover = this.recoverAfterRemoval(this.toasts.filter((t) => !next.includes(t)).map((t) => t.id))
    this.toasts = next
    void recover()
    // A toast with an action waits for the reader, like an error: a
    // timeout could take the action away before it is read (WCAG 2.2.1).
    if (toast.kind === 'info' && !toast.action) {
      this.timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), TOAST_TIMEOUT_MS))
    }
  }

  private clearTimer(id: number) {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
  }

  private dismiss(id: number) {
    const recover = this.recoverAfterRemoval([id])
    this.clearTimer(id)
    this.toasts = this.toasts.filter((t) => t.id !== id)
    void recover()
  }

  private recoverAfterRemoval(ids: number[]) {
    const focused = this.shadowRoot?.activeElement?.closest<HTMLElement>('[data-toast-id]')
    const ownsFocus = !!focused && ids.includes(Number(focused.dataset.toastId))
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('[data-toast-id]')]
    const at = focused ? rows.indexOf(focused) : -1
    const version = this.focusVersion
    return async () => {
      await this.updateComplete
      // An action can deliberately select its own destination. Any later
      // focus movement also belongs to the reader, not this recovery.
      if (!ownsFocus || !this.isConnected || version !== this.focusVersion) return
      let active = document.activeElement
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
      if (active && active !== document.body && active.isConnected) return
      const remaining = rows.filter((row) => row.isConnected)
      const next = rows.slice(at + 1).find((row) => row.isConnected)
        ?? remaining.at(-1)
      const control = next?.querySelector<LitElement>('caribou-button, caribou-icon-button')
      await control?.updateComplete
      if (version !== this.focusVersion) return
      const root = this.getRootNode()
      const target = control?.shadowRoot?.querySelector<HTMLElement>('button')
        ?? this.workTargets.find(canRestoreFocus)
        ?? (root instanceof ShadowRoot ? root.querySelector<HTMLElement>('main') : null)
      if (target && canRestoreFocus(target)) target.focus()
    }
  }

  private renderList(kind: ToastKind) {
    return repeat(this.toasts.filter((t) => t.kind === kind), (t) => t.id, (t) => html`
      <div class="toast" data-toast-id=${t.id} data-kind=${t.kind} role=${kind === 'error' ? 'alert' : nothing}>
        <span class="message">${t.message}</span>
        ${t.action ? html`<caribou-button class="action" variant="secondary"
          @click=${() => { this.dismiss(t.id); t.action!.run() }}>${t.action.label}</caribou-button>` : nothing}
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

function canRestoreFocus(target: HTMLElement): boolean {
  if (!target.isConnected || target.matches(':disabled, [aria-disabled="true"]')) return false
  let el: Element | null = target
  while (el) {
    if (el.matches('[hidden], [inert], dialog:not([open])') || getComputedStyle(el).display === 'none'
      || getComputedStyle(el).visibility === 'hidden') return false
    const root = el.getRootNode()
    el = el.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
  }
  return true
}
