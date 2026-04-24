import { Elena, html } from '@elenajs/core'

export class CaribouNewPostsBanner extends Elena(HTMLElement) {
  static override tagName = 'caribou-new-posts-banner'
  // `count` is a number — reflect-false so setter triggers a re-render
  // without mirroring the value to the attribute.
  static override props = [{ name: 'count', reflect: false }]
  // `click` bubbles, so Elena's listener on the inner wrapper catches
  // it and delivers it to this host's `handleEvent`.
  static override events = ['click']

  count = 0

  handleEvent(e: Event) {
    if (e.type !== 'click') return
    // Only dispatch when the actual button is the target — guards
    // against clicks on the empty wrapper.
    const target = e.target as HTMLElement | null
    if (!target?.closest('button[data-action="apply-new-posts"]')) return
    this.dispatchEvent(
      new CustomEvent('apply-new-posts', { bubbles: true, composed: true }),
    )
  }

  override render() {
    // Always render a stable wrapper so Elena has an `element` to bind
    // the click listener to, even when count is 0.
    if (!this.count || this.count < 1) {
      return html`<div data-banner="empty"></div>`
    }
    return html`
      <div data-banner="active">
        <button type="button" data-action="apply-new-posts"
                style="position:sticky;top:0;z-index:2;width:100%;padding:var(--space-2) var(--space-3);
                       border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer;
                       border-radius:0 0 var(--radius-md) var(--radius-md);">
          ${this.count} new ${this.count === 1 ? 'post' : 'posts'}
        </button>
      </div>
    `
  }
}
CaribouNewPostsBanner.define()
