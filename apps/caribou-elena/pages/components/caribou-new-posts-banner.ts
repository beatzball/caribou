import { Elena, html } from '@elenajs/core'

export class CaribouNewPostsBanner extends Elena(HTMLElement) {
  static override tagName = 'caribou-new-posts-banner'
  static override props = ['count']

  count = 0

  private onClick() {
    this.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true, composed: true }))
  }

  override render() {
    if (!this.count || this.count < 1) return html``
    return html`
      <button type="button" @click=${() => this.onClick()}
              style="position:sticky;top:0;z-index:2;width:100%;padding:var(--space-2) var(--space-3);
                     border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer;
                     border-radius:0 0 var(--radius-md) var(--radius-md);">
        ${this.count} new ${this.count === 1 ? 'post' : 'posts'}
      </button>
    `
  }
}
CaribouNewPostsBanner.define()
