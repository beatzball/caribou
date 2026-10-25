import { LitElement, html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import { activeUserKey } from '@beatzball/caribou-state'
import { ICONS } from './_icons.js'
import { spaClick } from './_spa-link.js'
import './caribou-signout-form.js'

interface NavItem { label: string; icon: TemplateResult; href: string }

const ITEMS: NavItem[] = [
  { label: 'Home',    icon: ICONS.home,  href: '/home' },
  { label: 'Local',   icon: ICONS.users, href: '/local' },
  { label: 'Public',  icon: ICONS.globe, href: '/public' },
  { label: 'Profile', icon: ICONS.user,  href: '/@me' },
]

// lucide square-pen, same shape as the set in _icons.ts.
const PEN_ICON = html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
  width="1em" height="1em" aria-hidden="true"
  style="display:inline-block;vertical-align:-0.125em"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></g></svg>`

function openCompose() {
  window.dispatchEvent(new CustomEvent('caribou:compose', { detail: {} }))
}

@customElement('caribou-nav-rail')
export class CaribouNavRail extends LitElement {
  static override styles = css`
    :host { display: block; }
    nav { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
    a, .signout-btn, .compose-btn {
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
    .compose-btn {
      display: none; width: 100%;
      background: var(--accent); color: var(--accent-fg); border: 0; cursor: pointer;
      font: inherit; text-align: left;
    }
    .compose-btn:hover { background: var(--accent); filter: brightness(1.1); }
    :host([can-compose]) .compose-btn { display: flex; }
    :host([signed-out]) caribou-signout-form { display: none; }
    .icon { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
    .icon svg { width: 20px; height: 20px; }

    /* Medium: shell drops to a 56px nav column. Hide labels and center icons
       so the selected-state background fills the column. */
    @media (min-width: 768px) and (max-width: 1023px) {
      nav { padding: var(--space-2); }
      a, .signout-btn, .compose-btn { justify-content: center; padding: var(--space-2); }
      .label { display: none; }
    }

    /* Mobile: nav becomes a fixed bottom bar; row-flex, no labels. */
    @media (max-width: 767px) {
      nav { flex-direction: row; justify-content: space-around;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: var(--bg-1); border-top: 1px solid var(--border); padding: var(--space-2); }
      a, .signout-btn, .compose-btn { padding: var(--space-2); justify-content: center; }
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
            ><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a>`
        })}
        <button type="button" class="compose-btn" aria-label="New post" @click=${openCompose}
          ><span class="icon">${PEN_ICON}</span><span class="label">New post</span></button>
        <caribou-signout-form>
          <form action="/api/signout" method="post" class="signout-form">
            <button type="submit" class="signout-btn">
              <span class="icon">${ICONS.logOut}</span><span class="label">Sign out</span>
            </button>
          </form>
        </caribou-signout-form>
      </nav>
    `
  }
}
