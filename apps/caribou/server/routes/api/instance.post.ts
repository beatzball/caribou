import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { handleSetInstance } from '../../lib/set-instance.js'
import { getStorage } from '../../lib/storage.js'

export default defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event).catch(() => null)
  const result = await handleSetInstance(event, body, { storage: getStorage() })
  if (!result.ok) throw createError({ statusCode: result.status, statusMessage: result.message })
  setResponseStatus(event, 204)
  return ''
})
