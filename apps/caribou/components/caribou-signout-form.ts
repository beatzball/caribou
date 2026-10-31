import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { signOutActive } from '@beatzball/caribou-state'
import { landAs } from './_switch-account.js'

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
@customElement('caribou-signout-form')
export class CaribouSignoutForm extends LitElement {
  static override styles = css`:host { display: contents; }`

  private onSubmit = (e: Event) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const action = form.action || '/api/signout'
    const next = signOutActive()
    void fetch(action, { method: 'POST', credentials: 'same-origin' })
      .catch(() => {})
      .finally(() => landAs(next))
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
