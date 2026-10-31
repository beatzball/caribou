import { defineEventHandler, readBody, createError } from 'h3'
import { startSignin, registerMastodonApp } from '../../../lib/signin-start.js'
import { getStorage } from '../../../lib/storage.js'
import { resolveOrigin } from '../../../lib/public-origin.js'
import { setSigninCookie } from '../../../lib/signin-binding.js'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ server?: string; add?: unknown }>(event)
  if (!body || typeof body.server !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'server is required' })
  }
  const origin = resolveOrigin(event)
  try {
    const { authorizeUrl, nonce } = await startSignin({ server: body.server, origin, add: body.add === true }, {
      storage: getStorage(),
      registerApp: registerMastodonApp,
    })
    // Binds the state to this browser; the callback checks it.
    setSigninCookie(event, nonce)
    return { authorizeUrl }
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `instance unreachable: ${(err as Error).message}`,
    })
  }
})
