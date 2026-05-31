import { html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { CaribouElena } from './elena-shadow.js'
import { PACKAGE_VERSION } from '../../server/build-meta.generated.js'
import './caribou-signout-form.js'

const APP_NAME = 'Caribou'
const REPO_URL = 'https://github.com/beatzball/caribou'

const RIGHT_RAIL_CSS = `
  :host { display: block; padding: var(--space-3); }
  .card  { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-3); }
  .card a { color: var(--fg-1); text-decoration: none; }
  .card a:hover { color: var(--accent); }
  litro-link { display: contents; }
  .links { list-style: none; margin: 0; padding: 0; }
  .links a { display: block; padding: var(--space-2) 0; }
  .session { color: var(--fg-1); margin-top: var(--space-2); }
  .session strong { color: var(--fg-0); }
  .signout-btn { background: transparent; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-decoration: underline; font: inherit; }
  /* SSR default: signed-in chrome visible. Hydration sets [signed-out]
     when localStorage has no active session, flipping to the passive
     "Browsing X" variant. */
  :host([signed-out]) .signed-in { display: none; }
  :host(:not([signed-out])) .browsing { display: none; }
  [aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; padding: var(--space-1) 0; }
`

export class CaribouRightRail extends CaribouElena(HTMLElement) {
  static override tagName = 'caribou-right-rail'
  static override shadow = 'open' as const
  static override styles = RIGHT_RAIL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string = ''
  private _unsubscribe?: () => void

  override connectedCallback() {
    super.connectedCallback?.()
    if (typeof window === 'undefined') return
    this._unsubscribe = effect(() => {
      if (activeUserKey.value === null) this.setAttribute('signed-out', '')
      else this.removeAttribute('signed-out')
    })
  }

  override disconnectedCallback() {
    this._unsubscribe?.()
    this._unsubscribe = undefined
    super.disconnectedCallback?.()
  }

  override render() {
    const inst = this.instance
    return html`
      <div class="card">
        <strong>${APP_NAME}</strong>
        <div>v${PACKAGE_VERSION}</div>
        <a href="${REPO_URL}" rel="noopener" target="_blank">GitHub</a>
      </div>
      <div class="card">
        <ul class="links">
          <li><litro-link><a href="/privacy">Privacy</a></litro-link></li>
          <li><litro-link><a href="/about">About</a></litro-link></li>
        </ul>
        ${inst
          ? html`<div class="session signed-in">Signed in to <strong>${inst}</strong> ·
                   <caribou-signout-form>
                     <form action="/api/signout" method="post" style="display:inline;">
                       <button type="submit" class="signout-btn">Sign out</button>
                     </form>
                   </caribou-signout-form>
                 </div>
                 <div class="session browsing">Browsing <strong>${inst}</strong></div>`
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
