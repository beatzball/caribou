import { Elena } from '@elenajs/core'
import { removeActiveUser } from '@beatzball/caribou-state'

/**
 * Composite signout wrapper. Same shape as the patched <litro-link>:
 * no render, no shadow — consumer provides the <form>, this element
 * intercepts the submit, clears client session state, fires the POST
 * via fetch, then hard-reloads at `/` so SSR re-renders the landing
 * with no stale timeline / signed-in chrome in the DOM.
 */
export class CaribouSignoutForm extends Elena(HTMLElement) {
  static override tagName = 'caribou-signout-form'

  private onSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const action = form.action || '/api/signout'
    removeActiveUser()
    void fetch(action, { method: 'POST', credentials: 'same-origin' })
      .catch(() => {})
      .finally(() => {
        location.replace('/')
      })
  }

  override connectedCallback() {
    super.connectedCallback?.()
    this.querySelector('form')?.addEventListener('submit', this.onSubmit)
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.()
    this.querySelector('form')?.removeEventListener('submit', this.onSubmit)
  }
}
CaribouSignoutForm.define()
