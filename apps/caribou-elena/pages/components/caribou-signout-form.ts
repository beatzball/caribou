import { Elena } from '@elenajs/core'
import { removeActiveUser } from '@beatzball/caribou-state'

/**
 * Composite signout wrapper. Same shape as the patched <litro-link>:
 * no render, no shadow — consumer provides the <form>, this element only
 * adds a synchronous submit listener that calls removeActiveUser() before
 * the native form POST proceeds. Progressive enhancement: no-JS users
 * still get a working server-side signout.
 */
export class CaribouSignoutForm extends Elena(HTMLElement) {
  static override tagName = 'caribou-signout-form'

  private onSubmit = (_e: SubmitEvent) => {
    removeActiveUser()
    // Native form POST proceeds to /api/signout.
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
