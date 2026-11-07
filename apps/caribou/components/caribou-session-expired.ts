import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUser, isBlueskySession, type BlueskySession } from '@beatzball/caribou-state'
import { startBlueskySignIn } from './_bluesky-session.js'
import './caribou-button.js'

/**
 * "Your Bluesky session ended. Sign in again." (spec 5.6). Shown while the
 * active session is a Bluesky one marked `expired`. The page, the drafts and
 * the prefs stay; signing in again to the same DID clears it (state rule 11).
 * The server and the first client render show nothing.
 */
@customElement('caribou-session-expired')
export class CaribouSessionExpired extends LitElement {
  static override styles = css`
    :host { display: block; }
    [role="status"] {
      box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);
      max-width: 640px; padding: var(--space-3); margin: var(--space-3) auto 0;
      background: var(--bg-2); color: var(--fg-0); border-radius: var(--radius-md);
    }
    p { margin: 0; flex: 1 1 16rem; }
    .error { color: var(--danger); flex-basis: 100%; }
  `

  @state() private session: BlueskySession | null = null
  @state() private busy = false
  @state() private error: string | null = null
  private stop?: () => void

  protected override firstUpdated() {
    this.stop = effect(() => {
      const user = activeUser.value
      this.session = user && isBlueskySession(user) && user.expired ? user : null
    })
  }

  override disconnectedCallback() {
    this.stop?.()
    this.stop = undefined
    super.disconnectedCallback()
  }

  private async signIn() {
    if (!this.session || this.busy) return
    this.busy = true
    this.error = null
    this.error = await startBlueskySignIn(this.session.did)
    this.busy = false
  }

  override render() {
    if (!this.session) return nothing
    return html`
      <div role="status">
        <p>Your Bluesky session ended. Sign in again.</p>
        <caribou-button variant="primary" ?loading=${this.busy} @click=${this.signIn}>Sign in again</caribou-button>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-session-expired': CaribouSessionExpired
  }
}
