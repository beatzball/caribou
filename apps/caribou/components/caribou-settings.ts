import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SETTINGS_SECTIONS } from './_settings-sections.js'

// The body of /settings: a heading and the sections in `_settings-sections.ts`.
// Add a section there, not here.
@customElement('caribou-settings')
export class CaribouSettings extends LitElement {
  static override styles = css`
    :host { display: block; }
    article { color: var(--fg-1); padding: var(--space-4); max-width: 640px; }
    h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; margin: 0 0 var(--space-4); color: var(--fg-0); }
    .note {
      margin: 0 0 var(--space-4); padding: var(--space-3); border-radius: var(--radius-md);
      border: 1px solid var(--border); background: var(--bg-1); color: var(--fg-0);
    }
    section { padding: var(--space-4) 0; border-top: 1px solid var(--border); scroll-margin-top: var(--space-4); }
    h2 { font-size: 1.125rem; font-weight: 600; margin: 0 0 var(--space-3); color: var(--fg-0); }
  `

  /** This browser refuses storage: the page shows the defaults and says why. */
  @property({ type: Boolean, attribute: 'storage-blocked' }) storageBlocked = false

  private onHashChange = () => { this.scrollToFragment() }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('hashchange', this.onHashChange)
  }

  override disconnectedCallback() {
    window.removeEventListener('hashchange', this.onHashChange)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.scrollToFragment()
  }

  // The sections are in this shadow root, where the browser's own fragment
  // scroll cannot find them (it looks up the id in the document). So
  // `/settings#<id>` is handled here.
  private scrollToFragment() {
    let id = ''
    try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
    if (id) this.shadowRoot?.getElementById(id)?.scrollIntoView()
  }

  override render() {
    return html`
      <article>
        <h1>Settings</h1>
        ${this.storageBlocked
          ? html`<p class="note">This browser does not let Caribou store data, so Caribou cannot save settings here. These are the defaults.</p>`
          : nothing}
        ${SETTINGS_SECTIONS.map((s) => html`
          <section id=${s.id} aria-labelledby=${`${s.id}-h`}>
            <h2 id=${`${s.id}-h`}>${s.heading}</h2>
            ${s.render()}
          </section>`)}
      </article>
    `
  }
}
