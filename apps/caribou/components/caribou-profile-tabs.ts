import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { spaClick } from './_spa-link.js'
import './caribou-tabs.js'

export type ProfileTabName = 'posts' | 'replies' | 'media'

const TABS: readonly ProfileTabName[] = ['posts', 'replies', 'media']

@customElement('caribou-profile-tabs')
export class CaribouProfileTabs extends LitElement {
  static override styles = css`
    :host { display: block; }
  `

  // The handle segment of the profile route: `alice@example.social`, or `me`.
  // The route is `/@:handle`, so the page hands it over without the `@`; a
  // handle that still carries one is accepted too.
  @property({ reflect: true }) handle = ''
  @property({ reflect: true }) tab: ProfileTabName = 'posts'

  override render() {
    const base = `/@${this.handle.replace(/^@/, '')}`
    return html`
      <caribou-tabs label="Profile">
        ${TABS.map((t) => html`<a href=${`${base}?tab=${t}`}
          aria-current=${t === this.tab ? 'page' : nothing} @click=${spaClick}>${t}</a>`)}
      </caribou-tabs>
    `
  }
}
