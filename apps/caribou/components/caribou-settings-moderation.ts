import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { spaClick } from './_spa-link.js'

// The Moderation section of /settings: one link to the page that lists the
// reader's filters, muted and blocked accounts (`/settings/moderation`).
// That page stands alone; this only leads to it.
@customElement('caribou-settings-moderation')
export class CaribouSettingsModeration extends LitElement {
  static override styles = css`
    :host { display: block; }
    p { margin: 0 0 var(--space-2); color: var(--fg-1); }
    a { color: var(--accent); }
  `

  override render() {
    return html`<div>
      <p>Your server's filters, and the accounts you mute or block.</p>
      <a href="/settings/moderation" @click=${spaClick}>Filters, mutes and blocks</a>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-settings-moderation': CaribouSettingsModeration }
}
