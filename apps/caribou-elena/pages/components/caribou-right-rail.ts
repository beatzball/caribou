import { html } from '@elenajs/core'
import { CaribouElena } from './elena-shadow.js'
import { PACKAGE_VERSION } from '../../server/build-meta.generated.js'

const APP_NAME = 'Caribou'
const REPO_URL = 'https://github.com/beatzball/caribou'

const RIGHT_RAIL_CSS = `
  :host { display: block; padding: var(--space-3); }
  .card  { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-3); }
  .card a { color: var(--fg-1); text-decoration: none; }
  .card a:hover { color: var(--accent); }
  .links { list-style: none; margin: 0; padding: 0; }
  .links a { display: block; padding: var(--space-2) 0; }
  .signed-in { color: var(--fg-1); margin-top: var(--space-2); }
  .signed-in strong { color: var(--fg-0); }
  .signout-btn { background: transparent; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-decoration: underline; font: inherit; }
  [aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; padding: var(--space-1) 0; }
`

export class CaribouRightRail extends CaribouElena(HTMLElement) {
  static override tagName = 'caribou-right-rail'
  static override shadow = 'open' as const
  static override styles = RIGHT_RAIL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string = ''

  override render() {
    const inst = this.instance
    return html`
      <div class="card">
        <strong>${APP_NAME}</strong>
        <div>v${PACKAGE_VERSION}</div>
        <a href=${REPO_URL} rel="noopener" target="_blank">GitHub</a>
      </div>
      <div class="card">
        <ul class="links">
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/about">About</a></li>
        </ul>
        ${inst
          ? html`<div class="signed-in">Signed in to <strong>${inst}</strong> ·
                   <form action="/api/signout" method="post" style="display:inline;">
                     <button type="submit" class="signout-btn">Sign out</button>
                   </form>
                 </div>`
          : html``}
      </div>
      <div class="card">
        <div aria-disabled="true" title="Coming soon">Theme toggle</div>
        <div aria-disabled="true" title="Coming soon">Zen mode</div>
        <div aria-disabled="true" title="Coming soon">Keyboard shortcuts</div>
      </div>
    `
  }
}
CaribouRightRail.define()
