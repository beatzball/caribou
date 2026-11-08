import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import { finishBlueskySignIn } from './_bluesky-session.js'

let navigated = false

/** Tests only. */
export function resetCallbackForTests(): void {
  navigated = false
}

/**
 * The Bluesky callback page's body (spec 5.5, steps 4 to 6). It finishes
 * the sign-in once, on the first client update, then goes to `/home`. The
 * server and the first client render show the same "Signing you in" line.
 */
@customElement('caribou-bluesky-callback')
export class CaribouBlueskyCallback extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    main { max-width: 480px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
    h1 { font-size: 1.5rem; margin: 0 0 var(--space-3) 0; }
    p { color: var(--fg-1); }
    [role="alert"] { color: var(--danger); }
    a { color: var(--accent); }
  `]

  @state() private error: string | null = null

  // `finishBlueskySignIn` runs once per page load, however many times this
  // element is made: the SDK's state is single-use (spec 12.2).
  protected override firstUpdated() {
    finishBlueskySignIn().then(
      () => {
        // One navigation per load, also with two elements: a second
        // `replace` would cancel the first.
        if (navigated) return
        navigated = true
        location.replace('/home')
      },
      (err: unknown) => { this.error = err instanceof Error ? err.message : String(err) },
    )
  }

  override render() {
    return html`
      <main>
        <h1>Bluesky sign-in</h1>
        ${this.error
          ? html`<p role="alert">${this.error}</p><p><a href="/">Back to sign-in</a></p>`
          : html`<p role="status">Signing you in…</p>`}
      </main>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-bluesky-callback': CaribouBlueskyCallback
  }
}
