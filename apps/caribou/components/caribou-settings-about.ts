import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { PACKAGE_VERSION } from '../server/build-meta.generated.js'
import { spaClick } from './_spa-link.js'
import './caribou-changelog-dot.js'

// The running version and a link to /changelog. The Settings nav item shows
// the changelog's unread dot; this link carries it too, so the reader can
// see where it leads. Opening /changelog clears it.
@customElement('caribou-settings-about')
export class CaribouSettingsAbout extends LitElement {
  static override styles = css`
    :host { display: block; }
    p { margin: 0 0 var(--space-2); }
    a { color: var(--accent); }
    /* Room for the dot is kept from the start, so it moves nothing. */
    .wrap { position: relative; display: inline-block; padding-right: 10px; }
  `

  override render() {
    return html`
      <p>Caribou ${PACKAGE_VERSION}</p>
      <p><a href="/changelog" @click=${spaClick}><span class="wrap"><span
        class="label">Changelog</span><caribou-changelog-dot></caribou-changelog-dot></span><caribou-changelog-dot
        text></caribou-changelog-dot></a></p>
    `
  }
}
