import { Elena, html } from '@elenajs/core'

const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  state_mismatch: 'Sign-in expired or was tampered with. Try again.',
  exchange_failed: "Couldn't complete sign-in with that instance. Try again.",
  verify_failed: "Couldn't verify your account with the instance. Try again.",
  unauthorized: 'Your session expired. Sign in again.',
  unreachable: "Couldn't reach that instance. Check the spelling and try again.",
}

/**
 * Captured once per document lifetime. Litro's client-side router
 * destroys and re-creates the outlet subtree after SSR hydration, which
 * means every route swap produces a brand-new <caribou-error-banner>.
 * If each instance tried to read `location.search` and then clear the
 * query param, the FIRST (SSR-hydrated) instance would consume `?error=…`
 * and clean the URL — leaving the second (router-mounted) instance,
 * which is the one actually visible to the user, with `code = null`.
 *
 * We read the param at module load so every instance sees the same
 * code. The URL clean-up is deferred to a rAF so that external
 * observers (e.g. Playwright's `waitForURL` watching for a redirect to
 * `/?error=unauthorized`) have a chance to see the query param in the
 * address bar before we strip it.
 */
function scheduleUrlCleanup(): void {
  const doCleanup = () => {
    const u = new URL(location.href)
    if (!u.searchParams.has('error') && !u.searchParams.has('instance')) return
    u.searchParams.delete('error')
    u.searchParams.delete('instance')
    history.replaceState(null, '', u.pathname + (u.search ? u.search : ''))
  }
  // Defer the rewrite so CDP observers (e.g. Playwright's `waitForURL`,
  // which waits for `load` by default) can read `?error=…` before we
  // strip it. Schedule well after `load`: a synchronous `replaceState`
  // during the load phase can be interpreted as the frame "navigating
  // away" by Playwright, which surfaces as `net::ERR_ABORTED`.
  const run = () => setTimeout(doCleanup, 250)
  if (document.readyState === 'complete') {
    run()
  } else {
    window.addEventListener('load', run, { once: true })
  }
}

function captureErrorCode(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(location.href)
  const code = url.searchParams.get('error')
  if (code) scheduleUrlCleanup()
  return code
}

let capturedCode: string | null | undefined
function getCapturedCode(): string | null {
  if (capturedCode === undefined) capturedCode = captureErrorCode()
  return capturedCode
}

export class CaribouErrorBanner extends Elena(HTMLElement) {
  static override tagName = 'caribou-error-banner'
  private code: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    this.code = getCapturedCode()
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
