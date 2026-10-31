import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import {
  activeUserKey, UNREAD_CAP, unreadNotificationCount, userName, users, type UserSession,
} from '@beatzball/caribou-state'
import { spaClick } from './_spa-link.js'
import { switchToAccount } from './_switch-account.js'
import type { IconName } from './caribou-icon.js'
import './caribou-button.js'
import './caribou-icon.js'
import './caribou-menu.js'
import './caribou-signout-form.js'

// `more`: on a phone the item lives in the More menu instead of the bar.
interface NavItem { label: string; icon: IconName; href: string; more?: boolean }

// The items above New post. DOM order is the visual order at every width,
// so Tab and the picture agree: the phone bar reads Home, Local, …, New
// post, Profile, More once the `more` items are hidden.
const ITEMS: NavItem[] = [
  { label: 'Home',    icon: 'home',  href: '/home' },
  { label: 'Local',   icon: 'users', href: '/local' },
  { label: 'Notifications', icon: 'bell', href: '/notifications' },
  { label: 'Public',  icon: 'globe', href: '/public', more: true },
  { label: 'Bookmarks', icon: 'bookmark', href: '/bookmarks', more: true },
]

const PROFILE: NavItem = { label: 'Profile', icon: 'user', href: '/@me' }

/** `@name@server`: the handle that names the account on any server. */
export function fullHandle(user: Pick<UserSession, 'userKey' | 'account' | 'server'>): string {
  return `@${userName(user)}@${user.server}`
}

/** The stored accounts, the active one first, the rest in stored order. */
export function orderAccounts(all: Iterable<UserSession>, active: string | null): UserSession[] {
  const list = [...all]
  const current = list.filter((u) => u.userKey === active)
  return [...current, ...list.filter((u) => u.userKey !== active)]
}

function openCompose() {
  window.dispatchEvent(new CustomEvent('caribou:compose', { detail: {} }))
}

@customElement('caribou-nav-rail')
export class CaribouNavRail extends LitElement {
  static override styles = css`
    :host { display: block; }
    nav { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
    a, .signout-btn {
      display: flex; align-items: center; gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      color: var(--fg-1); text-decoration: none; border-radius: var(--radius-md);
      box-sizing: border-box;
    }
    .signout-btn {
      width: 100%;
      background: transparent; border: 0; cursor: pointer;
      font: inherit; text-align: left;
    }
    .switch-btn {
      width: 100%; color: var(--fg-1); border-radius: var(--radius-md); box-sizing: border-box;
      background: transparent; border: 0; cursor: pointer; font: inherit; text-align: left;
    }
    a:hover, .signout-btn:hover, .switch-btn:hover { background: var(--bg-1); }
    a[aria-current="page"] { background: var(--bg-2); color: var(--fg-0); }
    /* Not the same as current: the shown page keeps its look, the tapped
       item gets an accent underline until its page arrives. */
    a[data-pending] { color: var(--fg-0); box-shadow: inset 0 -2px 0 var(--accent); }
    .signout-form { display: contents; }
    /* Composing needs a session and JS. The server never sets
       can-compose, so without both the button is not shown at all. */
    .compose-btn { display: none; width: 100%; }
    :host([can-compose]) .compose-btn { display: flex; }
    /* The rail's rows are left-aligned icon + label; the button centers. */
    .compose-btn::part(button) { justify-content: flex-start; }
    :host([signed-out]) caribou-signout-form,
    :host([signed-out]) .signed-in-only { display: none; }
    .icon { font-size: 20px; flex-shrink: 0; }
    /* The icon and the count share one box, so the badge can sit on the
       icon's corner when the label is hidden. */
    .icon-wrap { position: relative; display: inline-flex; }
    .badge {
      position: absolute; top: -6px; right: -8px;
      min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
      border-radius: 8px; background: var(--accent); color: var(--bg-0);
      font-size: 11px; font-weight: 600; line-height: 16px; text-align: center;
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }

    /* The account button sits at the foot of the rail (Elk's place for it).
       Its box is the same before and after hydration: the server does not
       know the accounts, so it renders an empty avatar and empty lines that
       the client fills in. */
    .account { display: flex; margin-top: auto; }
    .account::part(trigger) {
      flex: 1; min-width: 0; justify-content: flex-start; gap: var(--space-2);
      padding: var(--space-2) var(--space-3); color: var(--fg-1); text-align: left;
    }
    .who { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
    .avatar {
      width: 32px; height: 32px; flex: none; border-radius: 50%; object-fit: cover;
      background: var(--bg-2); color: var(--fg-1);
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 14px; text-transform: uppercase;
    }
    .who-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .who-name, .who-acct {
      display: block; min-height: 1.25em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .who-name { color: var(--fg-0); font-weight: 600; }
    .who-acct { font-size: 0.875em; color: var(--fg-1); }
    .check { margin-left: auto; padding-left: var(--space-2); color: var(--accent); }
    .sep { border-top: 1px solid var(--border); margin: var(--space-1) 0; }
    .menu-item caribou-icon { pointer-events: none; }
    caribou-menu .account-item { min-height: 48px; }
    caribou-menu .account-item .who-text { text-align: left; }

    /* Below desktop the rail shows icons only. The label stays in the
       accessibility tree, clipped rather than display: none, because it is
       each control's only name: the icon is aria-hidden. */
    @media (max-width: 1023px) {
      .label {
        position: absolute; width: 1px; height: 1px; overflow: hidden;
        clip-path: inset(50%); white-space: nowrap;
      }
      /* The account button collapses to its avatar. The text is clipped,
         not display: none, so the button's name still says who is signed in. */
      .account > [slot="trigger"] .who-text {
        position: absolute; width: 1px; height: 1px; overflow: hidden;
        clip-path: inset(50%); white-space: nowrap;
      }
    }

    /* Medium: shell drops to a 56px nav column. Center icons so the
       selected-state background fills the column. */
    @media (min-width: 768px) and (max-width: 1023px) {
      nav { padding: var(--space-2); }
      a, .signout-btn, .compose-btn::part(button) { justify-content: center; padding: var(--space-2); }
      .account::part(trigger) { justify-content: center; padding: var(--space-2); }
    }

    /* Beside the page, the rail stays in view, so the account button is at
       the foot of the window and not at the end of a long timeline. The
       account menu opens above it, on the left. */
    @media (min-width: 768px) {
      /* A short window cannot fit every row; the rail then scrolls on its
         own, so the account button (and Sign out) stays reachable. */
      nav {
        position: sticky; top: 0; box-sizing: border-box;
        height: 100vh; height: 100dvh;
        overflow-y: auto;
      }
      .account {
        --caribou-menu-right: auto;
        --caribou-menu-left: var(--space-3);
        --caribou-menu-bottom: calc(var(--space-3) + 54px + var(--space-2));
      }
    }
    /* After the block above, so the narrow rail's offsets win there. */
    @media (min-width: 768px) and (max-width: 1023px) {
      .account { --caribou-menu-left: var(--space-2); --caribou-menu-bottom: calc(2 * var(--space-2) + 48px); }
    }

    /* Mobile: nav becomes a fixed bottom bar; row-flex.
       Items are 44px square, the touch size iOS asks for. The bar keeps
       clear of the home indicator: on iOS Safari a tap at the very bottom
       edge can bring back the browser toolbar instead of reaching the page.
       The inset is 0 unless the viewport meta says viewport-fit=cover. */
    @media (max-width: 767px) {
      nav { flex-direction: row; justify-content: space-around;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: var(--bg-1); border-top: 1px solid var(--border); padding: var(--space-2);
            padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
            padding-left: calc(var(--space-2) + env(safe-area-inset-left, 0px));
            padding-right: calc(var(--space-2) + env(safe-area-inset-right, 0px)); }
      a, .signout-btn, .compose-btn::part(button) {
        min-width: 44px; min-height: 44px; padding: var(--space-2); justify-content: center;
      }
      /* One item among the others in the bar, not a full-width row. */
      .compose-btn { width: auto; }
    }

    /* The phone bar holds five items and More; the rest move into the
       More menu. Each item is in the DOM twice, once in the rail and once
       in the menu, and display: none keeps the hidden copy out of the
       accessibility tree, so a name is never heard twice. */
    .more { display: none; }
    /* The bar hides the rail's copy of a moved item, so More shows its
       current and pending marks. */
    .more[data-current]::part(trigger) { background: var(--bg-2); color: var(--fg-0); }
    .more[data-pending]::part(trigger) { color: var(--fg-0); box-shadow: inset 0 -2px 0 var(--accent); }
    caribou-menu .menu-item {
      display: flex; align-items: center; justify-content: flex-start; gap: var(--space-2);
      width: 100%; min-height: 44px; padding: var(--space-2) var(--space-3);
    }
    @media (max-width: 767px) {
      .in-more, .account { display: none; }
      .more {
        display: inline-flex;
        /* Above the bar and clear of the iOS edges. The bar is a 44px item,
           its padding and its 1px top border; the last --space-2 is the gap. */
        --caribou-menu-bottom: calc(44px + 3 * var(--space-2) + 1px + env(safe-area-inset-bottom, 0px));
        --caribou-menu-right: calc(var(--space-2) + env(safe-area-inset-right, 0px));
      }
    }
  `

  @property({ reflect: true }) current = ''

  // The server does not know the request path, so it renders no active item
  // unless `current` is set. Reading `location` in render() would make the
  // first client render differ from the server's; it is read after the first
  // update instead.
  @state() private path = ''

  private _unsubscribe?: () => void

  // The router keeps the old page, and this rail with it, on screen until the
  // next page has fetched its data and rendered — up to seconds on a phone.
  // It fires popstate the moment a link is followed, so the tapped item gets a
  // pending look at once instead of looking like the tap was lost.
  // `aria-current` stays on the page that is shown. The swap removes this rail
  // with its page, also when the next page's data fails (it renders without
  // it). A page chunk that fails to load — a stale client after a deploy —
  // rejects in the router and leaves this rail, so a rejection clears the mark.
  @state() private pending = ''

  // Always 0 on the server and in the first client render: the count needs
  // the session, which only the browser has. The count can be in before this
  // rail hydrates (a fast reply, or a page swap), so it waits for firstUpdated.
  @state() private unread = 0

  // The stored accounts and the active key. Empty on the server and in the
  // first client render, which must match it: the accounts are in
  // localStorage. Filled in by firstUpdated and then kept in step.
  @state() private accounts: UserSession[] = []
  @state() private activeKey: string | null = null

  private _onPopState = () => {
    const to = window.location.pathname
    this.pending = to === (this.current || this.path) ? '' : to
  }

  private _onRejection = () => { this.pending = '' }

  override connectedCallback() {
    super.connectedCallback()
    this._unsubscribe = effect(() => {
      this.toggleAttribute('signed-out', activeUserKey.value === null)
      this.toggleAttribute('can-compose', activeUserKey.value !== null)
      // Read on every run so the effect keeps following the count, but
      // shown only after the first update, which hydrates the server's 0.
      const unread = unreadNotificationCount.value
      const all = users.value
      const key = activeUserKey.value
      if (this.hasUpdated) {
        this.unread = unread
        this.readAccounts(all, key)
      }
    })
    window.addEventListener('popstate', this._onPopState)
    window.addEventListener('unhandledrejection', this._onRejection)
  }

  override disconnectedCallback() {
    this._unsubscribe?.()
    this._unsubscribe = undefined
    window.removeEventListener('popstate', this._onPopState)
    window.removeEventListener('unhandledrejection', this._onRejection)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.path = window.location.pathname
    this.unread = unreadNotificationCount.value
    this.readAccounts(users.value, activeUserKey.value)
  }

  private readAccounts(all: Map<string, UserSession>, key: string | null) {
    this.accounts = orderAccounts(all.values(), key)
    this.activeKey = key
  }

  private get activeAccount(): UserSession | null {
    return this.accounts.find((u) => u.userKey === this.activeKey) ?? null
  }

  // The count is shown on the icon and read after the label, so the link's
  // name stays its label: "Notifications, 3 unread".
  private renderIcon(it: NavItem) {
    const icon = html`<caribou-icon class="icon" name=${it.icon}></caribou-icon>`
    if (it.href !== '/notifications' || this.unread === 0) return icon
    return html`<span class="icon-wrap">${icon}<span class="badge" aria-hidden="true">${this.unreadLabel()}</span></span>`
  }

  private renderUnreadText(it: NavItem) {
    if (it.href !== '/notifications' || this.unread === 0) return nothing
    return html`<span class="sr-only">, ${this.unreadLabel()} unread</span>`
  }

  private unreadLabel(): string {
    return this.unread >= UNREAD_CAP ? `${UNREAD_CAP}+` : String(this.unread)
  }

  private renderItem(it: NavItem, active: string) {
    const isActive = it.href === active || (it.href === '/@me' && active.startsWith('/@me'))
    const isPending = it.href === this.pending || (it.href === '/@me' && this.pending.startsWith('/@me/'))
    return html`<a href=${it.href} aria-current=${isActive ? 'page' : nothing}
      class=${it.more ? 'in-more' : nothing} ?data-pending=${isPending} aria-busy=${isPending ? 'true' : nothing} @click=${spaClick}
      >${this.renderIcon(it)}<span class="label">${it.label}</span>${this.renderUnreadText(it)}</a>`
  }

  // An account not loaded yet (only the active one is loaded, on each page
  // load) shows its first letter. The empty one is the server's placeholder.
  private renderAvatar(user: UserSession | null) {
    const a = user?.account
    const src = a ? a.avatarStatic || a.avatar : ''
    if (src) return html`<img class="avatar" src=${src} alt="" width="32" height="32" decoding="async" />`
    return html`<span class="avatar" aria-hidden="true">${user ? userName(user).charAt(0) : ''}</span>`
  }

  private renderWho(user: UserSession | null, before = '') {
    const name = user ? user.account?.displayName || userName(user) : ''
    return [this.renderAvatar(user), html`<span class="who-text">${before
      ? html`<span class="sr-only">${before} </span>` : nothing}<span class="who-name">${name}</span>
      <span class="who-acct">${user ? fullHandle(user) : ''}</span></span>`]
  }

  // The account list, Add account and Sign out: the account menu's items,
  // and on a phone the end of the More menu. The current account is first,
  // with a check, and goes to its profile; another account switches to it,
  // which reloads the page as that account.
  //
  // "Add account" goes to `/?add`. Phase 3 of #58 builds the add-account form
  // there; until then it is the landing page's sign-in form, which adds the
  // new account to the stored ones.
  //
  // A list of one-element templates, not one template with several roots:
  // happy-dom misplaces a binding at the top level of a template, so the
  // tests would see the values in the wrong places.
  private renderAccountItems() {
    const current = this.activeAccount
    return [
      ...this.accounts.map((u) => u.userKey === this.activeKey
        ? html`<a href="/@me" class="menu-item account-item signed-in-only" aria-current="true"
            @click=${spaClick}>${this.renderWho(u, 'Signed in as')}<caribou-icon class="check"
            name="check"></caribou-icon></a>`
        : html`<button type="button" class="switch-btn menu-item account-item signed-in-only"
            @click=${() => { void switchToAccount(u.userKey) }}>${this.renderWho(u, 'Switch to')}</button>`),
      html`<a href="/?add" class="menu-item signed-in-only"
        ><caribou-icon class="icon" name="userPlus"></caribou-icon>Add account</a>`,
      html`<caribou-signout-form>
        <form action="/api/signout" method="post" class="signout-form">
          <button type="submit" class="signout-btn menu-item">
            <caribou-icon class="icon" name="logOut"></caribou-icon>${current
              ? `Sign out of ${fullHandle(current)}` : 'Sign out'}
          </button>
        </form>
      </caribou-signout-form>`,
    ]
  }

  override render() {
    const active = this.current || this.path
    const moved = ITEMS.filter((it) => it.more)
    return html`
      <nav aria-label="Primary">
        ${ITEMS.map((it) => this.renderItem(it, active))}
        <caribou-button variant="primary" class="compose-btn" @click=${openCompose}
          ><caribou-icon class="icon" name="squarePen"></caribou-icon><span class="label">New post</span></caribou-button>
        ${this.renderItem(PROFILE, active)}
        <caribou-menu class="more" icon="ellipsis" label="More"
          ?data-current=${moved.some((it) => it.href === active)}
          ?data-pending=${moved.some((it) => it.href === this.pending)}>
          ${moved.map((it) => html`<a href=${it.href} class="menu-item"
            aria-current=${it.href === active ? 'page' : nothing} @click=${spaClick}
            ><caribou-icon class="icon" name=${it.icon}></caribou-icon>${it.label}</a>`)}
          <div class="sep signed-in-only" aria-hidden="true"></div>
          ${this.renderAccountItems()}
        </caribou-menu>
        <caribou-menu class="account signed-in-only" label="Accounts">
          <span slot="trigger" class="who">${this.renderWho(this.activeAccount)}</span>
          ${this.renderAccountItems()}
        </caribou-menu>
      </nav>
    `
  }
}
