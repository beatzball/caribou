import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import './caribou-error-banner.js'
import './caribou-instance-picker.js'

@customElement('caribou-landing')
export class CaribouLanding extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    main { max-width: 640px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
    h1 { font-size: 2rem; margin: 0 0 var(--space-2) 0; }
    p { color: var(--fg-1); margin: 0 0 var(--space-5) 0; }
  `]

  override render() {
    return html`
      <main>
        <h1>Caribou</h1>
        <p>
          A Mastodon client. Enter your instance to sign in.
        </p>
        <caribou-error-banner></caribou-error-banner>
        <caribou-instance-picker></caribou-instance-picker>
      </main>
    `
  }
}
