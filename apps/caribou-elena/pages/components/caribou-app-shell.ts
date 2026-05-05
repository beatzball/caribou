import { html } from '@elenajs/core'
import { CaribouElena } from './elena-shadow.js'
import './caribou-nav-rail.js'
import './caribou-right-rail.js'

const SHELL_CSS = `
  :host { display: block; min-height: 100vh; background: var(--bg-0); color: var(--fg-0); }
  .shell-grid {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas: "main";
    min-height: 100vh;
  }
  caribou-nav-rail   { grid-area: nav;   }
  caribou-right-rail { grid-area: right; display: none; }
  main { grid-area: main; max-width: 640px; margin: 0 auto; width: 100%; padding: var(--space-4) 0 calc(var(--space-6) * 2); }
  @media (min-width: 768px) {
    .shell-grid { grid-template-columns: 56px 1fr; grid-template-areas: "nav main"; }
  }
  @media (min-width: 1024px) {
    .shell-grid { grid-template-columns: 200px 1fr 280px; grid-template-areas: "nav main right"; }
    caribou-right-rail { display: block; }
  }
`

export class CaribouAppShell extends CaribouElena(HTMLElement) {
  static override tagName = 'caribou-app-shell'
  static override shadow = 'open' as const
  static override styles = SHELL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string = ''

  override updated() {
    // Elena does not wire `.prop=` bindings; assign the right rail's `instance`
    // imperatively on every update so cookie changes propagate without remount.
    const rail = this.shadowRoot?.querySelector<HTMLElement & { instance: string }>('caribou-right-rail')
    if (rail && rail.instance !== this.instance) rail.instance = this.instance
  }

  override render() {
    return html`
      <div class="shell-grid">
        <caribou-nav-rail></caribou-nav-rail>
        <main><slot></slot></main>
        <caribou-right-rail></caribou-right-rail>
      </div>
    `
  }
}
CaribouAppShell.define()
