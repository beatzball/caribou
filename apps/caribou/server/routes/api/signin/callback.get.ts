import { defineEventHandler, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { completeSignin, exchangeCodeForToken, verifyCredentialsFetch } from '../../../lib/signin-callback.js'
import { setInstance } from '../../../lib/instance-cookie.js'
import { getStorage } from '../../../lib/storage.js'
import { clearSigninCookie, readSigninCookie } from '../../../lib/signin-binding.js'
import { COMPLETE_PAGE_CSP, completeSigninPage } from '../../../lib/signin-complete-page.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await completeSignin(
    {
      code: typeof query.code === 'string' ? query.code : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
      nonce: readSigninCookie(event),
    },
    {
      storage: getStorage(),
      exchangeCode: exchangeCodeForToken,
      verifyCredentials: verifyCredentialsFetch,
    },
  )
  // One sign-in per nonce: whatever the result, the cookie is spent.
  clearSigninCookie(event)
  if (result.kind !== 'ok') return sendRedirect(event, result.location, 302)

  // Success: this response itself carries the session to the browser that
  // started the sign-in. It holds a token, so nothing may keep it, and the
  // URL (with its `code`) must not leak as a referrer.
  setInstance(event, result.server)
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'content-security-policy', COMPLETE_PAGE_CSP)
  return completeSigninPage(result.session)
})
