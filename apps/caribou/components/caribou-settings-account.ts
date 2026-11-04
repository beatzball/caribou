import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey, userName, users, type UserSession } from '@beatzball/caribou-state'
import { spaClick } from './_spa-link.js'
import { switchToAccount } from './_switch-account.js'
import { fullHandle, orderAccounts } from './caribou-nav-rail.js'
import './caribou-button.js'
import './caribou-icon.js'
import './caribou-signout-form.js'

// Who is signed in, and the account menu's actions: the profile, a switch to
// each other stored account, Add account, and Sign out of this account only.
// Sign out is a native form, the same one the nav rail uses, so it works
// the same way.
@customElement('caribou-settings-account')
export class CaribouSettingsAccount extends LitElement {
  static override styles = css`
    :host { display: block; }
    .who { display: flex; align-items: center; gap: var(--space-3); margin: 0 0 var(--space-3); }
    .avatar {
      width: 48px; height: 48px; flex: none; border-radius: 50%; object-fit: cover;
      background: var(--bg-2); color: var(--fg-1);
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 20px; text-transform: uppercase;
    }
    .who-text { display: flex; flex-direction: column; min-width: 0; }
    .who-label { color: var(--fg-muted); font-size: 0.875em; }
    .who-name { color: var(--fg-0); font-weight: 600; overflow-wrap: anywhere; }
    .who-acct { color: var(--fg-1); font-size: 0.875em; overflow-wrap: anywhere; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
    a, button {
      display: flex; align-items: center; gap: var(--space-2);
      width: 100%; min-height: 44px; padding: 0 var(--space-3); box-sizing: border-box;
      color: var(--fg-1); text-decoration: none; border-radius: var(--radius-md);
      background: transparent; border: 0; cursor: pointer; font: inherit; text-align: left;
    }
    a:hover, button:hover { background: var(--bg-1); color: var(--fg-0); }
    .signout { color: var(--danger); }
    /* "Switch to" is the shared button, shaped like the rows around it. */
    caribou-button.switch {
      display: flex; width: 100%;
      --caribou-button-size: 44px; --caribou-button-bg: transparent; --caribou-button-fg: var(--fg-1);
    }
    caribou-button.switch::part(button) {
      justify-content: flex-start; gap: var(--space-2);
      padding: 0 var(--space-3); border: 0; text-align: left;
    }
    caribou-button.switch::part(button):hover { background: var(--bg-1); color: var(--fg-0); }
    form { display: contents; }
    caribou-icon { font-size: 20px; flex: none; }
  `

  @state() private accounts: UserSession[] = []
  @state() private activeKey: string | null = null
  private stop?: () => void

  override connectedCallback() {
    super.connectedCallback()
    if (typeof window === 'undefined') return
    this.stop = effect(() => {
      this.accounts = orderAccounts(users.value.values(), activeUserKey.value)
      this.activeKey = activeUserKey.value
    })
  }

  override disconnectedCallback() {
    this.stop?.()
    this.stop = undefined
    super.disconnectedCallback()
  }

  private renderAvatar(user: UserSession) {
    const a = user.account
    const src = a ? a.avatarStatic || a.avatar : ''
    if (src) return html`<img class="avatar" src=${src} alt="" width="48" height="48" decoding="async" />`
    return html`<span class="avatar" aria-hidden="true">${userName(user).charAt(0)}</span>`
  }

  override render() {
    const current = this.accounts.find((u) => u.userKey === this.activeKey)
    if (!current) return nothing
    const others = this.accounts.filter((u) => u !== current)
    return html`
      <div>
        <p class="who">
          ${this.renderAvatar(current)}
          <span class="who-text">
            <span class="who-label">Signed in as</span>
            <span class="who-name">${current.account?.displayName || userName(current)}</span>
            <span class="who-acct">${fullHandle(current)}</span>
          </span>
        </p>
        <ul>
          <li><a href="/@me" @click=${spaClick}><caribou-icon name="user"></caribou-icon>Your profile</a></li>
          ${others.map((u) => html`<li><caribou-button class="switch" @click=${() => { void switchToAccount(u.userKey) }}
            ><caribou-icon name="users"></caribou-icon>Switch to ${fullHandle(u)}</caribou-button></li>`)}
          <li><a href="/?add" @click=${spaClick}><caribou-icon name="userPlus"></caribou-icon>Add account</a></li>
          <li>
            <caribou-signout-form>
              <form action="/api/signout" method="post">
                <!-- Native: sign-out must work with JavaScript off. -->
                <button type="submit" class="signout"><caribou-icon name="logOut"></caribou-icon>Sign out of ${fullHandle(current)}</button>
              </form>
            </caribou-signout-form>
          </li>
        </ul>
      </div>
    `
  }
}
