import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { completeSignin, exchangeCodeForToken, verifyCredentialsFetch } from '../../../lib/signin-callback.js'
import { getStorage } from '../../../lib/storage.js'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await completeSignin(
    {
      code: typeof query.code === 'string' ? query.code : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
    },
    {
      storage: getStorage(),
      exchangeCode: exchangeCodeForToken,
      verifyCredentials: verifyCredentialsFetch,
    },
  )
  return sendRedirect(event, result.location, 302)
})
