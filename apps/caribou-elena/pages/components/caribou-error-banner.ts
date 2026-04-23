import { Elena, html } from '@elenajs/core'

const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  state_mismatch: 'Sign-in expired or was tampered with. Try again.',
  exchange_failed: "Couldn't complete sign-in with that instance. Try again.",
  verify_failed: "Couldn't verify your account with the instance. Try again.",
  unauthorized: 'Your session expired. Sign in again.',
  unreachable: "Couldn't reach that instance. Check the spelling and try again.",
}

export class CaribouErrorBanner extends Elena(HTMLElement) {
  static override tagName = 'caribou-error-banner'
  private code: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    const url = new URL(location.href)
    this.code = url.searchParams.get('error')
    if (this.code) {
      url.searchParams.delete('error')
      url.searchParams.delete('instance')
      history.replaceState(null, '', url.pathname + (url.search ? url.search : ''))
    }
    this.requestUpdate()
  }

  override render() {
    if (!this.code) return html``
    const message = MESSAGES[this.code] ?? `Sign-in error: ${this.code}`
    return html`
      <div role="alert" style="padding:var(--space-3);background:var(--bg-2);color:var(--danger);border-radius:var(--radius-md);margin-bottom:var(--space-4);">
        ${message}
      </div>
    `
  }
}
CaribouErrorBanner.define()
