import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { activeUser, signOutActive } from '@beatzball/caribou-state'
import { claimSignOut, land } from './_switch-account.js'

/**
 * Composite signout wrapper. The consumer provides the <form>; this element
 * intercepts the submit, signs out of the active account only, fires the POST
 * via fetch, then hard-reloads so SSR re-renders with no stale timeline in
 * the DOM. When another account is left it becomes active, the instance
 * cookie is pointed at its server, and the reader stays on the same page if
 * it makes sense for that account (`pathAfterSwitch`). With none left the
 * reload goes to `/`. The cookie is never cleared, so the public feeds keep
 * their server after the last sign-out.
 *
 * Without JavaScript the form posts natively and the server redirects.
 */
// One sign-out per document (`claimSignOut`). The first submit removes the
// current account and makes the next one active at once; a repeat would sign
// out of the survivor too. The landing that follows is shared with the 401
// handler, so a 401 during the sign-out POST still ends in one navigation as
// the right account.
@customElement('caribou-signout-form')
export class CaribouSignoutForm extends LitElement {
  static override styles = css`:host { display: contents; }`

  private onSubmit = (e: Event) => {
    e.preventDefault()
    if (!claimSignOut()) return
    const form = e.target as HTMLFormElement
    const action = form.action || '/api/signout'
    const from = activeUser.value?.server ?? null
    signOutActive()
    const post = fetch(action, { method: 'POST', credentials: 'same-origin' })
    void land({ from, after: post })
  }

  // `submit` bubbles but is not composed, so it reaches this host from the
  // slotted form and goes no further. Listen on the host, and register before
  // `super` so the listener is live even while hydration is deferred.
  override connectedCallback() {
    this.addEventListener('submit', this.onSubmit)
    super.connectedCallback()
  }

  override disconnectedCallback() {
    this.removeEventListener('submit', this.onSubmit)
    super.disconnectedCallback()
  }

  override render() {
    return html`<slot></slot>`
  }
}
