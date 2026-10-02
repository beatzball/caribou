import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

@customElement('caribou-new-posts-banner')
export class CaribouNewPostsBanner extends LitElement {
  static override styles = css`
    :host { display: block; }
    button {
      position: sticky; top: 0; z-index: 2;
      width: 100%; padding: var(--space-2) var(--space-3);
      border: 0; background: var(--accent); color: var(--accent-fg); cursor: pointer;
      border-radius: 0 0 var(--radius-md) var(--radius-md);
    }
  `

  @property({ type: Number }) count = 0

  private onClick = () => {
    this.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true, composed: true }))
  }

  override render() {
    if (!this.count || this.count < 1) return nothing
    return html`
      <button type="button" data-action="apply-new-posts" @click=${this.onClick}>
        ${this.count} new ${this.count === 1 ? 'post' : 'posts'}
      </button>
    `
  }
}
