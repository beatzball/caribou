import { html } from '@elenajs/core'
import { CaribouElena } from './elena-shadow.js'
import { ICONS } from './_icons.js'

type ElenaTemplate = ReturnType<typeof html>

const NAV_RAIL_CSS = `
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
  .icon { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
  .icon svg { width: 20px; height: 20px; }

  /* Medium: shell drops to a 56px nav column. Hide labels and center icons
     so the selected-state background fills the column. */
  @media (min-width: 768px) and (max-width: 1023px) {
    nav { padding: var(--space-2); }
    a, .signout-btn { justify-content: center; padding: var(--space-2); }
    .label { display: none; }
  }

  /* Mobile: nav becomes a fixed bottom bar; row-flex, no labels. */
  @media (max-width: 767px) {
    nav { flex-direction: row; justify-content: space-around;
          position: fixed; bottom: 0; left: 0; right: 0;
          background: var(--bg-1); border-top: 1px solid var(--border); padding: var(--space-2); }
    a, .signout-btn { padding: var(--space-2); justify-content: center; }
    .label { display: none; }
  }
`

interface NavItem { label: string; icon: ElenaTemplate; href: string }

const ITEMS: NavItem[] = [
  { label: 'Home',    icon: ICONS.home,  href: '/home' },
  { label: 'Local',   icon: ICONS.users, href: '/local' },
  { label: 'Public',  icon: ICONS.globe, href: '/public' },
  { label: 'Profile', icon: ICONS.user,  href: '/@me' },
]

export class CaribouNavRail extends CaribouElena(HTMLElement) {
  static override tagName = 'caribou-nav-rail'
  static override shadow = 'open' as const
  static override styles = NAV_RAIL_CSS
  static override props = [{ name: 'current', reflect: true }]

  current: string = ''

  override render() {
    const active = this.current || (typeof window !== 'undefined' ? window.location.pathname : '/')
    return html`
      <nav aria-label="Primary">
        ${ITEMS.map((it) => {
          const isActive = it.href === active || (it.href === '/@me' && active.startsWith('/@me'))
          return isActive
            ? html`<a href="${it.href}" aria-current="page"><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a>`
            : html`<a href="${it.href}"><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a>`
        })}
        <form class="signout-form" action="/api/signout" method="post">
          <button type="submit" class="signout-btn">
            <span class="icon">${ICONS.logOut}</span><span class="label">Sign out</span>
          </button>
        </form>
      </nav>
    `
  }
}
CaribouNavRail.define()
