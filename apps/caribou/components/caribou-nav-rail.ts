import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { spaClick } from './_spa-link.js'
import type { IconName } from './caribou-icon.js'
import './caribou-button.js'
import './caribou-icon.js'
import './caribou-signout-form.js'

interface NavItem { label: string; icon: IconName; href: string }

const ITEMS: NavItem[] = [
  { label: 'Home',    icon: 'home',  href: '/home' },
  { label: 'Local',   icon: 'users', href: '/local' },
  { label: 'Public',  icon: 'globe', href: '/public' },
  { label: 'Profile', icon: 'user',  href: '/@me' },
]

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
    a:hover, .signout-btn:hover { background: var(--bg-1); }
    a[aria-current="page"], a[data-pending] { background: var(--bg-2); color: var(--fg-0); }
    .signout-form { display: contents; }
    /* Composing needs a session and JS. The server never sets
       can-compose, so without both the button is not shown at all. */
    .compose-btn { display: none; width: 100%; }
    :host([can-compose]) .compose-btn { display: flex; }
    /* The rail's rows are left-aligned icon + label; the button centers. */
    .compose-btn::part(button) { justify-content: flex-start; }
    :host([signed-out]) caribou-signout-form { display: none; }
    .icon { font-size: 20px; flex-shrink: 0; }

    /* Below desktop the rail shows icons only. The label stays in the
       accessibility tree, clipped rather than display: none, because it is
       each control's only name: the icon is aria-hidden. */
    @media (max-width: 1023px) {
      .label {
        position: absolute; width: 1px; height: 1px; overflow: hidden;
        clip-path: inset(50%); white-space: nowrap;
      }
    }

    /* Medium: shell drops to a 56px nav column. Center icons so the
       selected-state background fills the column. */
    @media (min-width: 768px) and (max-width: 1023px) {
      nav { padding: var(--space-2); }
      a, .signout-btn, .compose-btn::part(button) { justify-content: center; padding: var(--space-2); }
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
            padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px)); }
      a, .signout-btn, .compose-btn::part(button) {
        min-width: 44px; min-height: 44px; padding: var(--space-2); justify-content: center;
      }
      /* One item among the others in the bar, not a full-width row. */
      .compose-btn { width: auto; }
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
  // with its page; a failed navigation leaves it, so a rejection clears the mark.
  @state() private pending = ''

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
  }

  override render() {
    const active = this.current || this.path
    return html`
      <nav aria-label="Primary">
        ${ITEMS.map((it) => {
          const isActive = it.href === active || (it.href === '/@me' && active.startsWith('/@me'))
          const isPending = it.href === this.pending || (it.href === '/@me' && this.pending.startsWith('/@me/'))
          return html`<a href=${it.href} aria-current=${isActive ? 'page' : nothing}
            ?data-pending=${isPending} @click=${spaClick}
            ><caribou-icon class="icon" name=${it.icon}></caribou-icon><span class="label">${it.label}</span></a>`
        })}
        <caribou-button variant="primary" class="compose-btn" @click=${openCompose}
          ><caribou-icon class="icon" name="squarePen"></caribou-icon><span class="label">New post</span></caribou-button>
        <caribou-signout-form>
          <form action="/api/signout" method="post" class="signout-form">
            <button type="submit" class="signout-btn">
              <caribou-icon class="icon" name="logOut"></caribou-icon><span class="label">Sign out</span>
            </button>
          </form>
        </caribou-signout-form>
      </nav>
    `
  }
}
