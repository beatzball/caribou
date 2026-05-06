import { Elena, html } from '@elenajs/core'

const TABS_CSS = `
  :host { display: block; border-bottom: 1px solid var(--border); }
  nav { display: flex; gap: 0; }
  a { padding: var(--space-3) var(--space-4); color: var(--fg-1); text-decoration: none; border-bottom: 2px solid transparent; }
  a[aria-current="page"] { color: var(--fg-0); border-bottom-color: var(--accent); }
`

const TABS = ['posts', 'replies', 'media'] as const

export class CaribouProfileTabs extends Elena(HTMLElement) {
  static override tagName = 'caribou-profile-tabs'
  static override shadow = 'open' as const
  static override styles = TABS_CSS
  static override props = [
    { name: 'handle', reflect: true },
    { name: 'tab',    reflect: true },
  ]
  handle: string = ''
  tab: 'posts' | 'replies' | 'media' = 'posts'

  override render() {
    return html`
      <nav>
        ${TABS.map((t) => {
          const href = `/${this.handle}?tab=${t}`
          return t === this.tab
            ? html`<a href="${href}" aria-current="page">${t}</a>`
            : html`<a href="${href}">${t}</a>`
        })}
      </nav>
    `
  }
}
CaribouProfileTabs.define()
