import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { removeActiveUser } from '@beatzball/caribou-state'

/**
 * Composite signout wrapper. The consumer provides the <form>; this element
 * intercepts the submit, clears client session state, fires the POST via
 * fetch, then hard-reloads at `/` so SSR re-renders the landing with no stale
 * timeline / signed-in chrome in the DOM.
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
    removeActiveUser()
    void fetch(action, { method: 'POST', credentials: 'same-origin' })
      .catch(() => {})
      .finally(() => {
        location.replace('/')
      })
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
