import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { getCapturedCode } from './_error-code.js'

const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  state_mismatch: 'Sign-in expired or was tampered with. Try again.',
  exchange_failed: "Couldn't complete sign-in with that instance. Try again.",
  verify_failed: "Couldn't verify your account with the instance. Try again.",
  unauthorized: 'Your session expired. Sign in again.',
  unreachable: "Couldn't reach that instance. Check the spelling and try again.",
}

@customElement('caribou-error-banner')
export class CaribouErrorBanner extends LitElement {
  static override styles = css`
    :host { display: block; }
    [role="alert"] {
      box-sizing: border-box;
      padding: var(--space-3);
      background: var(--bg-2);
      color: var(--danger);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-4);
    }
  `

  // The server never has an error code, so it renders nothing. The first
  // client render must match that; the code is read after the first update.
  @state() private code: string | null = null

  protected override firstUpdated() {
    this.code = getCapturedCode()
  }

  override render() {
    if (!this.code) return nothing
    const message = MESSAGES[this.code] ?? `Sign-in error: ${this.code}`
    return html`<div role="alert">${message}</div>`
  }
}
