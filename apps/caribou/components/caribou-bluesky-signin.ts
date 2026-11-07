import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import { startBlueskySignIn } from './_bluesky-session.js'
import './caribou-button.js'

/**
 * The Bluesky sign-in form (spec 5.5, step 2): a handle, a DID or a PDS
 * address. It never guesses the network: this form is Bluesky only.
 */
@customElement('caribou-bluesky-signin')
export class CaribouBlueskySignin extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    form { display: flex; flex-direction: column; gap: var(--space-3); max-width: 400px; margin: 0 auto; }
    label { color: var(--fg-1); }
    .hint { color: var(--fg-2); font-size: 0.875rem; margin: 0; }
    input {
      padding: var(--space-3); border-radius: var(--radius-md);
      border: 1px solid var(--border); background: var(--bg-1); color: var(--fg-0);
    }
    caribou-button { --caribou-button-size: 2.75rem; }
    [role="alert"] { color: var(--danger); margin: 0; }
  `]

  @state() private submitting = false
  @state() private error: string | null = null

  private async onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (this.submitting) return
    const input = this.renderRoot.querySelector<HTMLInputElement>('input[name="handle"]')!
    const value = input.value.trim()
    if (!value) return
    this.submitting = true
    this.error = null
    // On success the page goes to the authorization server and this never
    // returns; it answers only a message for the reader.
    this.error = await startBlueskySignIn(value)
    this.submitting = false
  }

  override render() {
    return html`
      <form @submit=${this.onSubmit} novalidate>
        <label for="bsky-handle">Bluesky handle</label>
        <input id="bsky-handle" name="handle" type="text" required
          autocomplete="username" autocapitalize="none" spellcheck="false"
          placeholder="alice.bsky.social" aria-describedby="bsky-hint" />
        <p class="hint" id="bsky-hint">A handle, a DID, or your server's address (https://…).</p>
        <caribou-button variant="primary" type="submit" ?loading=${this.submitting}>
          ${this.submitting ? 'Connecting…' : 'Sign in'}
        </caribou-button>
        ${this.error ? html`<p role="alert">${this.error}</p>` : nothing}
      </form>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-bluesky-signin': CaribouBlueskySignin
  }
}
