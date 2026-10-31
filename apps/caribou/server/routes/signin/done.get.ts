import { defineEventHandler, setResponseHeader } from 'h3'
import { SIGNIN_FALLBACK_PAGE } from '../../lib/signin-complete-page.js'

// Sign-in used to end here, with the session in the URL fragment. That let
// any link sign a reader in to someone else's account, so the session now
// comes only in the callback's own response (`signin-complete-page.ts`).
// The route stays for old links and bookmarks: it stores nothing and only
// offers the way back to the start.
export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return SIGNIN_FALLBACK_PAGE
})
