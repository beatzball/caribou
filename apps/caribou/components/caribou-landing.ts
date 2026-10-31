import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUser, userName, type UserSession } from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { spaClick } from './_spa-link.js'
import './caribou-error-banner.js'
import './caribou-instance-picker.js'

/**
 * "You are signed in as @bob@two.example." Only the active account: the
 * line stays one line at phone width, and the account menu lists the rest.
 */
export function signedInAs(active: UserSession | null): string {
  return active ? `You are signed in as @${userName(active)}@${active.server}.` : ''
}

@customElement('caribou-landing')
export class CaribouLanding extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    main { max-width: 640px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
    h1 { display: flex; align-items: center; gap: var(--space-3); font-size: 2rem; margin: 0 0 var(--space-2) 0; }
    h1 img { flex: none; }
    p { color: var(--fg-1); margin: 0 0 var(--space-5) 0; }
    /* The accounts live in the browser, so this line fills in after
       hydration. It keeps one line's height from the start, and stays one
       line, so nothing below it moves. */
    p.who {
      margin-top: calc(-1 * var(--space-3)); line-height: 1.5; min-height: 1.5em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .cancel { max-width: 400px; margin: var(--space-4) auto 0; text-align: center; }
    .cancel a {
      display: inline-flex; align-items: center; min-height: 44px; padding: 0 var(--space-3);
      color: var(--accent); text-decoration-line: underline;
    }
  `]

  // `/?add`: a signed-in reader adds another account.
  @property({ type: Boolean }) add = false

  // Empty on the server and in the first client render, which must match.
  @state() private who = ''

  private _unsubscribe?: () => void

  override connectedCallback() {
    super.connectedCallback()
    this._unsubscribe = effect(() => {
      const who = signedInAs(activeUser.value)
      if (this.hasUpdated) this.who = who
    })
  }

  override disconnectedCallback() {
    this._unsubscribe?.()
    this._unsubscribe = undefined
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.who = signedInAs(activeUser.value)
  }

  override render() {
    if (!this.add) {
      return html`
        <main>
          <h1><img src="/logo.png" alt="" width="48" height="48" />Caribou</h1>
          <p>
            A Mastodon client. Enter your instance to sign in.
          </p>
          <caribou-error-banner></caribou-error-banner>
          <caribou-instance-picker></caribou-instance-picker>
        </main>
      `
    }
    return html`
      <main>
        <h1><img src="/logo.png" alt="" width="48" height="48" />Add an account</h1>
        <p>Sign in to another Mastodon account. Enter its instance.</p>
        <p class="who">${this.who || nothing}</p>
        <caribou-error-banner></caribou-error-banner>
        <caribou-instance-picker add></caribou-instance-picker>
        <p class="cancel"><a href="/home" @click=${spaClick}>Cancel</a></p>
      </main>
    `
  }
}
