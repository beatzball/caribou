import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'

@customElement('caribou-auth-required')
export class CaribouAuthRequired extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    article { padding: 1rem; }
    h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; margin-bottom: 0.75rem; }
    p { color: var(--fg-1); }
    litro-link { color: var(--accent); text-decoration-line: underline; }
  `]

  @property({ reflect: true }) label = ''

  override render() {
    return html`
      <article class="auth-required-placeholder">
        <h1>Sign in to continue</h1>
        <p>
          ${this.label}
          <litro-link href="/">Sign in</litro-link>
          to view it.
        </p>
      </article>
    `
  }
}
