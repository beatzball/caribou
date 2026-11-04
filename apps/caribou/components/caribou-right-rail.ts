import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { PACKAGE_VERSION } from '../server/build-meta.generated.js'
import { searchPath } from './_search-query.js'
import './caribou-icon.js'
import './caribou-signout-form.js'

const APP_NAME = 'Caribou'
const REPO_URL = 'https://github.com/beatzball/caribou'

@customElement('caribou-right-rail')
export class CaribouRightRail extends LitElement {
  static override styles = css`
    :host { display: block; padding: var(--space-3); }
    .card  { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-3); }
    .card a, .card litro-link { color: var(--fg-1); text-decoration: none; }
    .card a:hover, .card litro-link:hover { color: var(--accent); }
    .links { list-style: none; margin: 0; padding: 0; }
    .links litro-link { display: block; padding: var(--space-2) 0; }
    .brand { display: flex; align-items: center; gap: var(--space-2); }
    .brand img { flex: none; }
    .session { color: var(--fg-1); margin-top: var(--space-2); }
    .session strong { color: var(--fg-0); }
    .signout-btn { background: transparent; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-decoration: underline; font: inherit; }
    /* SSR default: signed-in chrome visible. Hydration sets [signed-out]
       when localStorage has no active session, flipping to the passive
       "Browsing X" variant. */
    :host([signed-out]) .signed-in { display: none; }
    :host(:not([signed-out])) .browsing { display: none; }
    [aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; padding: var(--space-1) 0; }
    form.search { position: relative; display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
    form.search input {
      flex: 1; min-width: 0; font: inherit; color: var(--fg-0);
      background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3);
    }
    form.search input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    form.search caribou-icon { position: absolute; left: var(--space-3); color: var(--fg-muted); pointer-events: none; }
    form.search input { padding-left: calc(var(--space-3) * 2 + 1em); }
    .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `

  @property({ reflect: true }) instance = ''

  private _unsubscribe?: () => void

  override connectedCallback() {
    super.connectedCallback()
    this._unsubscribe = effect(() => {
      this.toggleAttribute('signed-out', activeUserKey.value === null)
    })
  }

  override disconnectedCallback() {
    this._unsubscribe?.()
    this._unsubscribe = undefined
    super.disconnectedCallback()
  }

  // Enter opens /search in the app; without JavaScript the form goes there
  // by itself.
  private onSearch = (e: Event) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const q = String(new FormData(form).get('q') ?? '').trim()
    void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(searchPath(q, 'accounts')))
  }

  override render() {
    const inst = this.instance
    return html`
      <form class="search" role="search" action="/search" method="get" @submit=${this.onSearch}>
        <caribou-icon name="search"></caribou-icon>
        <label class="vh" for="rail-search">Search</label>
        <input id="rail-search" type="search" name="q" autocomplete="off" enterkeyhint="search" placeholder="Search" />
      </form>
      <div class="card">
        <strong class="brand"><img src="/logo.png" alt="" width="24" height="24" />${APP_NAME}</strong>
        <div>v${PACKAGE_VERSION}</div>
        <a href=${REPO_URL} rel="noopener" target="_blank">GitHub</a>
      </div>
      <div class="card">
        <ul class="links">
          <li><litro-link href="/privacy">Privacy</litro-link></li>
          <li><litro-link href="/about">About</litro-link></li>
          <li><litro-link href="/changelog">Changelog</litro-link></li>
        </ul>
        ${inst
          // Native sign-out button: the form must work with JavaScript off.
          ? html`<div class="session signed-in">Signed in to <strong>${inst}</strong> ·
                   <caribou-signout-form>
                     <form action="/api/signout" method="post" style="display:inline;">
                       <button type="submit" class="signout-btn">Sign out</button>
                     </form>
                   </caribou-signout-form>
                 </div>
                 <div class="session browsing">Browsing <strong>${inst}</strong></div>`
          : nothing}
      </div>
      <div class="card">
        <div aria-disabled="true" title="Coming soon">Theme toggle</div>
        <div aria-disabled="true" title="Coming soon">Zen mode</div>
        <div aria-disabled="true" title="Coming soon">Keyboard shortcuts</div>
      </div>
    `
  }
}
