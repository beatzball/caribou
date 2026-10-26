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
    a[aria-current="page"] { background: var(--bg-2); color: var(--fg-0); }
    .signout-form { display: contents; }
    /* Composing needs a session and JS. The server never sets
       can-compose, so without both the button is not shown at all. */
    .compose-btn { display: none; width: 100%; }
    :host([can-compose]) .compose-btn { display: flex; }
    /* The rail's rows are left-aligned icon + label; the button centers. */
    .compose-btn::part(button) {
      justify-content: flex-start;
      padding: var(--space-2) var(--space-3);
    }
    :host([signed-out]) caribou-signout-form { display: none; }
    .icon { font-size: 20px; flex-shrink: 0; }

    /* Medium: shell drops to a 56px nav column. Hide labels and center icons
       so the selected-state background fills the column. */
    @media (min-width: 768px) and (max-width: 1023px) {
      nav { padding: var(--space-2); }
      a, .signout-btn, .compose-btn::part(button) { justify-content: center; padding: var(--space-2); }
      .label { display: none; }
    }

    /* Mobile: nav becomes a fixed bottom bar; row-flex, no labels. */
    @media (max-width: 767px) {
      nav { flex-direction: row; justify-content: space-around;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: var(--bg-1); border-top: 1px solid var(--border); padding: var(--space-2); }
      a, .signout-btn, .compose-btn::part(button) { padding: var(--space-2); justify-content: center; }
      /* One item among the others in the bar, not a full-width row. */
      .compose-btn { width: auto; }
      .label { display: none; }
    }
  `

  @property({ reflect: true }) current = ''

  // The server does not know the request path, so it renders no active item
  // unless `current` is set. Reading `location` in render() would make the
  // first client render differ from the server's; it is read after the first
  // update instead.
  @state() private path = ''

  private _unsubscribe?: () => void

  override connectedCallback() {
    super.connectedCallback()
    this._unsubscribe = effect(() => {
      this.toggleAttribute('signed-out', activeUserKey.value === null)
      this.toggleAttribute('can-compose', activeUserKey.value !== null)
    })
  }

  override disconnectedCallback() {
    this._unsubscribe?.()
    this._unsubscribe = undefined
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
          return html`<a href=${it.href} aria-current=${isActive ? 'page' : nothing} @click=${spaClick}
            ><caribou-icon class="icon" name=${it.icon}></caribou-icon><span class="label">${it.label}</span></a>`
        })}
        <caribou-button variant="primary" class="compose-btn" label="New post" @click=${openCompose}
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
