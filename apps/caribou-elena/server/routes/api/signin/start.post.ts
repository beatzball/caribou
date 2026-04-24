import { defineEventHandler, readBody, getRequestURL, createError } from 'h3'
import { startSignin, registerMastodonApp } from '../../../lib/signin-start.js'
import { getStorage } from '../../../lib/storage.js'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ server?: string }>(event)
  if (!body || typeof body.server !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'server is required' })
  }
  const url = getRequestURL(event)
  const origin = `${url.protocol}//${url.host}`
  try {
    return await startSignin({ server: body.server, origin }, {
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
