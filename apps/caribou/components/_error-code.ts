// The sign-in error code for this document, read once.
//
// A full page load mounts the landing page twice: the router hydrates the
// server-rendered element, then swaps in a second one. If each
// <caribou-error-banner> read the code for itself, the first would consume it
// (sessionStorage is read-and-remove; `?error=` is stripped from the URL) and
// the second — the one the user actually sees — would find nothing. So the
// code is captured at most once per document and every banner gets the same
// answer.

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
  // Client-side flows (401 interceptor) signal errors via sessionStorage
  // — race-free across the same-tab `location.replace`. Consume-on-read
  // so a later document doesn't pick it up again.
  try {
    const stashed = sessionStorage.getItem('caribou.error')
    if (stashed) {
      sessionStorage.removeItem('caribou.error')
      return stashed
    }
  } catch { /* ignore */ }
  // Server-side OAuth callback flows (e.g. `/signin/callback` 302
  // redirecting to `/?error=denied`) signal via URL query param — then
  // we clean it up for cosmetics.
  const url = new URL(location.href)
  const code = url.searchParams.get('error')
  if (code) scheduleUrlCleanup()
  return code
}

let capturedCode: string | null | undefined

export function getCapturedCode(): string | null {
  if (capturedCode === undefined) capturedCode = captureErrorCode()
  return capturedCode
}
