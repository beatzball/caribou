import { Elena, html } from '@elenajs/core'
import './caribou-error-banner.js'
import './caribou-instance-picker.js'

export class CaribouLanding extends Elena(HTMLElement) {
  static override tagName = 'caribou-landing'

  override render() {
    return html`
      <main style="max-width:640px;margin:0 auto;padding:var(--space-6) var(--space-4);">
        <h1 style="font-size:2rem;margin:0 0 var(--space-2) 0;">Caribou</h1>
        <p style="color:var(--fg-1);margin:0 0 var(--space-5) 0;">
          A Mastodon client. Enter your instance to sign in.
        </p>
        <caribou-error-banner></caribou-error-banner>
        <caribou-instance-picker></caribou-instance-picker>
      </main>
    `
  }
}
CaribouLanding.define()
