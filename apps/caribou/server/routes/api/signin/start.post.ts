import { defineEventHandler, readBody, createError } from 'h3'
import { startSignin, registerMastodonApp } from '../../../lib/signin-start.js'
import { getStorage } from '../../../lib/storage.js'
import { resolveOrigin } from '../../../lib/public-origin.js'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ server?: string; add?: unknown }>(event)
  if (!body || typeof body.server !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'server is required' })
  }
  const origin = resolveOrigin(event)
  try {
    return await startSignin({ server: body.server, origin, add: body.add === true }, {
      storage: getStorage(),
      registerApp: registerMastodonApp,
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `instance unreachable: ${(err as Error).message}`,
    })
  }
})
