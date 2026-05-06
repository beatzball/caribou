import { Elena, html } from '@elenajs/core'

export class CaribouAuthRequired extends Elena(HTMLElement) {
  static override tagName = 'caribou-auth-required'
  static override props = [{ name: 'label', reflect: true }]

  label: string = ''

  override render() {
    return html`
      <article class="auth-required-placeholder p-4">
        <h1 class="text-2xl font-semibold mb-3">Sign in to continue</h1>
        <p class="fg-1">
          ${this.label}
          <a href="/" class="text-accent underline">Sign in</a>
          to view it.
        </p>
      </article>
    `
  }
}
CaribouAuthRequired.define()
