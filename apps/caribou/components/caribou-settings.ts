import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { SETTINGS_SECTIONS } from './_settings-sections.js'

// The body of /settings: a heading and the sections in `_settings-sections.ts`.
// Add a section there, not here.
@customElement('caribou-settings')
export class CaribouSettings extends LitElement {
  static override styles = css`
    :host { display: block; }
    article { color: var(--fg-1); padding: var(--space-4); max-width: 640px; }
    h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; margin: 0 0 var(--space-4); color: var(--fg-0); }
    section { padding: var(--space-4) 0; border-top: 1px solid var(--border); }
    h2 { font-size: 1.125rem; font-weight: 600; margin: 0 0 var(--space-3); color: var(--fg-0); }
  `

  override render() {
    return html`
      <article>
        <h1>Settings</h1>
        ${SETTINGS_SECTIONS.map((s) => html`
          <section id=${s.id} aria-labelledby=${`${s.id}-h`}>
            <h2 id=${`${s.id}-h`}>${s.heading}</h2>
            ${s.render()}
          </section>`)}
      </article>
    `
  }
}
