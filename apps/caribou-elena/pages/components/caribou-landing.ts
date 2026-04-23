import { Elena, html } from '@elenajs/core'

export class CaribouLanding extends Elena(HTMLElement) {
  static override tagName = 'caribou-landing'

  override render() {
    return html`
      <main>
        <h1>Caribou</h1>
        <p>A Mastodon client, coming soon.</p>
      </main>
    `
  }
}

CaribouLanding.define()
