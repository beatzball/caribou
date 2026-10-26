import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { updating } from './_page-cache.js'

/**
 * "Updating…" while an old cached page refreshes (`_page-cache.ts`).
 *
 * One element for the whole document, appended to `body` once at start-up
 * (`app-main.ts`), never part of a page. A live region is announced when its
 * text changes, not when it arrives with its text: one inside the page would
 * be new on every navigation, and the router swaps the page in at the moment
 * the notice is needed. It is client-only; the server never renders it.
 */
@customElement('caribou-update-notice')
export class CaribouUpdateNotice extends LitElement {
  static override styles = css`
    /* A pill over the top of the page, so the list under it does not move. */
    div {
      position: fixed; z-index: 3; left: 50%; transform: translateX(-50%);
      top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
      padding: var(--space-1) var(--space-3); border-radius: 999px;
      background: var(--bg-2); color: var(--fg-muted);
      font-size: 0.875rem;
    }
    /* Empty, it has no box but stays in the accessibility tree. */
    div:empty { padding: 0; background: none; }
  `

  @state() private busy = false
  private dispose: (() => void) | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => { this.busy = updating.value > 0 })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  override render() {
    return html`<div role="status">${this.busy ? 'Updating…' : ''}</div>`
  }
}
