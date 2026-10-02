import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { spaClick } from './_spa-link.js'

export type ProfileTabName = 'posts' | 'replies' | 'media'

const TABS: readonly ProfileTabName[] = ['posts', 'replies', 'media']

@customElement('caribou-profile-tabs')
export class CaribouProfileTabs extends LitElement {
  static override styles = css`
    :host { display: block; border-bottom: 1px solid var(--border); }
    nav { display: flex; gap: 0; }
    a { padding: var(--space-3) var(--space-4); color: var(--fg-1); text-decoration: none; border-bottom: 2px solid transparent; }
    a[aria-current="page"] { color: var(--fg-0); border-bottom-color: var(--accent); }
  `

  @property({ reflect: true }) handle = ''
  @property({ reflect: true }) tab: ProfileTabName = 'posts'

  override render() {
    return html`
      <nav>
        ${TABS.map((t) => html`<a href=${`/${this.handle}?tab=${t}`}
          aria-current=${t === this.tab ? 'page' : nothing} @click=${spaClick}>${t}</a>`)}
      </nav>
    `
  }
}
