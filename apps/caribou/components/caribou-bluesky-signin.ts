import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { boxReset } from './_shared-styles.js'
import { startBlueskySignIn } from './_bluesky-session.js'
import './caribou-button.js'

/**
 * The sign-in in flight, shared by every form. On a full page load the
 * router swaps the server's page for a new one (#169): a sign-in started on
 * the first shows on the second, which does not start another.
 */
let pending: Promise<string | null> | null = null

/**
 * Sign-ins a page-cache Back forgot (#246). If one answers late, it writes
 * nothing: a newer sign-in may be out by then.
 */
const forgotten = new WeakSet<Promise<string | null>>()

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

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('pageshow', this.onPageshow)
  }

  override disconnectedCallback() {
    window.removeEventListener('pageshow', this.onPageshow)
    super.disconnectedCallback()
  }

  /**
   * Back from the authorization server can restore this page from the
   * browser's page cache, with the sign-in still "in flight". It never
   * answers: that page is gone. Forget it, so the form can be sent again
   * (#246).
   */
  private onPageshow = (e: Event) => {
    if (!(e as PageTransitionEvent).persisted) return
    if (pending) forgotten.add(pending)
    pending = null
    this.submitting = false
  }

  private async onSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (this.submitting || pending) return
    const input = this.renderRoot.querySelector<HTMLInputElement>('input[name="handle"]')!
    const value = input.value.trim()
    if (!value) return
    // On success the page goes to the authorization server and this never
    // returns; it answers only a message for the reader.
    await this.follow(startBlueskySignIn(value))
  }

  private async follow(signIn: Promise<string | null>) {
    pending = signIn
    this.submitting = true
    this.error = null
    try {
      const error = await signIn
      if (!forgotten.has(signIn)) this.error = error
    } finally {
      if (pending === signIn) pending = null
      if (!forgotten.has(signIn)) this.submitting = false
    }
  }

  // After the first render, never in it: the server's render is idle.
  protected override firstUpdated() {
    if (pending) void this.follow(pending)
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
