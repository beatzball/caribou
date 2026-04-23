import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import './components/caribou-home-timeline.js'

export default class HomePage extends LitroPage {
  static override tagName = 'page-home-feed'

  private onSignOut() {
    if (typeof window === 'undefined') return
    import('@beatzball/caribou-state').then(({ removeActiveUser }) => {
      removeActiveUser()
      location.href = '/'
    })
  }

  override connectedCallback() {
    super.connectedCallback?.()
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem('caribou.activeUserKey')
    if (!raw || raw === 'null' || raw === '""') {
      location.replace('/')
    }
  }

  override render() {
    return html`
      <main style="max-width:640px;margin:0 auto;">
        <header style="display:flex;align-items:center;justify-content:space-between;
                       padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);">
          <h1 style="margin:0;font-size:1.25rem;">Home</h1>
          <button type="button" @click=${() => this.onSignOut()}
                  style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);
                         border:1px solid var(--border);background:transparent;color:var(--fg-1);cursor:pointer;">
            Sign out
          </button>
        </header>
        <caribou-home-timeline></caribou-home-timeline>
      </main>
    `
  }
}
HomePage.define()
