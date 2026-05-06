import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import './components/caribou-timeline.js'
// Phase A POC: side-effect import so the customElements registry sees the
// shell class in dev. Wired into the page template in Phase F.
import './components/caribou-app-shell.js'

export default class FeedPage extends LitroPage {
  static override tagName = 'page-feed'
  // `click` bubbles, so Elena's listener on the inner wrapper element
  // catches the Sign-out button click and routes it through this host's
  // `handleEvent`.
  static override events = ['click']

  handleEvent(e: Event) {
    if (e.type !== 'click') return
    const target = e.target as HTMLElement | null
    if (!target?.closest('button[data-action="sign-out"]')) return
    if (typeof window === 'undefined') return
    void fetch('/api/signout', { method: 'POST' })
      .catch(() => {/* server-side cookie clear is best-effort; localStorage purge runs regardless */})
      .finally(() => {
        void import('@beatzball/caribou-state').then(({ removeActiveUser }) => {
          removeActiveUser()
          location.href = '/'
        })
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
          <button type="button" data-action="sign-out"
                  style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);
                         border:1px solid var(--border);background:transparent;color:var(--fg-1);cursor:pointer;">
            Sign out
          </button>
        </header>
        <caribou-timeline kind="home"></caribou-timeline>
      </main>
    `
  }
}
FeedPage.define()
