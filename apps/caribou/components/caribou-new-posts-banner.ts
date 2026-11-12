import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './caribou-button.js'

// A full-width accent bar at the top of a timeline: "3 new posts". The
// button is the shared primary <caribou-button>, reshaped into a bar.
@customElement('caribou-new-posts-banner')
export class CaribouNewPostsBanner extends LitElement {
  static override styles = css`
    :host { display: block; }
    .announcement {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
    }
    /* The bar keeps the size it had as a native button: small text (the
       browser's button size) and no minimum height. */
    caribou-button {
      display: flex; width: 100%;
      position: sticky; top: 0; z-index: 2;
      --caribou-button-size: auto;
    }
    caribou-button::part(button) {
      font-size: 0.8333rem;
      border: 0; padding: var(--space-2) var(--space-3);
      border-radius: 0 0 var(--radius-md) var(--radius-md);
    }
  `

  @property({ type: Number }) count = 0
  // A catch-up that did not meet the list's top post (a Bluesky feed, spec
  // 6.3 seam 7): the count is not all there is, and applying replaces the
  // list.
  @property({ type: Boolean }) many = false

  private onClick = () => {
    this.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true, composed: true }))
  }

  override render() {
    const label = this.count > 0
      ? this.many ? 'Many new posts' : `${this.count} new ${this.count === 1 ? 'post' : 'posts'}`
      : ''
    // Keep the region mounted before a background poll finds posts. Lit
    // leaves an unchanged string alone, so other updates do not repeat it.
    return html`<div>
      <div class="announcement" role="status" aria-live="polite" aria-atomic="true">${label ? `${label} available.` : ''}</div>
      ${label ? html`<caribou-button variant="primary" data-action="apply-new-posts" @click=${this.onClick}>
        ${label}
      </caribou-button>` : nothing}
    </div>`
  }
}
