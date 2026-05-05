import { html } from '@elenajs/core'
import { CaribouElena } from './elena-shadow.js'

const NAV_RAIL_CSS = `
  :host { display: block; }
  nav { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
  a {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--fg-1); text-decoration: none; border-radius: var(--radius-md);
  }
  a:hover { background: var(--bg-1); }
  a[aria-current="page"] { background: var(--bg-2); color: var(--fg-0); }
  .icon { width: 20px; height: 20px; display: inline-block; }
  @media (max-width: 767px) {
    nav { flex-direction: row; justify-content: space-around;
          position: fixed; bottom: 0; left: 0; right: 0;
          background: var(--bg-1); border-top: 1px solid var(--border); padding: var(--space-2); }
    .label { display: none; }
  }
`

interface NavItem { label: string; icon: string; href: string }

const ITEMS: NavItem[] = [
  { label: 'Home',    icon: 'i-lucide-home',     href: '/home' },
  { label: 'Local',   icon: 'i-lucide-users',    href: '/local' },
  { label: 'Public',  icon: 'i-lucide-globe',    href: '/public' },
  { label: 'Profile', icon: 'i-lucide-user',     href: '/@me' },
  { label: 'Sign out', icon: 'i-lucide-log-out', href: '/api/signout' },
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
            ? html`<a href=${it.href} aria-current="page"><span class="icon ${it.icon}"></span><span class="label">${it.label}</span></a>`
            : html`<a href=${it.href}><span class="icon ${it.icon}"></span><span class="label">${it.label}</span></a>`
        })}
      </nav>
    `
  }
}
CaribouNavRail.define()
