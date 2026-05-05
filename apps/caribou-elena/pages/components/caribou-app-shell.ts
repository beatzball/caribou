import { Elena, html } from '@elenajs/core'

// Minimal POC version of the app shell: just enough surface for Phase A's
// DSD render + hydration-parity gates to target a real component. The full
// shell — responsive grid with nav-rail / right-rail slots, instance
// forwarding into descendants, the lot — is built in Phase F (Task F1).
//
// Shadow DOM is mandatory. The shell sits at the root of every read-only
// route's pageData → DOM tree, so its shadow boundary is what walls the
// timeline + cards off from each other's morph engines (see §6 of the
// Plan 3 spec).
const SHELL_CSS = `
  :host { display: block; min-height: 100vh; background: var(--bg-0); color: var(--fg-0); }
  .shell-grid { display: grid; min-height: 100vh; }
  main { padding: var(--space-4); }
`

export class CaribouAppShell extends Elena(HTMLElement) {
  static override tagName = 'caribou-app-shell'
  static override shadow = 'open' as const
  static override styles = SHELL_CSS
  static override props = [{ name: 'instance', reflect: true }]

  instance: string | null = null

  override render() {
    return html`<div class="shell-grid"><main><slot></slot></main></div>`
  }
}
CaribouAppShell.define()
