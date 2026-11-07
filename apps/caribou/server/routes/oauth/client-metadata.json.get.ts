import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'
import { clientMetadata, configuredOrigin } from '../../lib/bluesky-client-metadata.js'

export default defineEventHandler((event) => {
  const origin = configuredOrigin()
  if (!origin) {
    setResponseStatus(event, 404)
    setResponseHeader(event, 'cache-control', 'no-store')
    return { error: 'NotConfigured', message: 'PUBLIC_BASE_URL is not set' }
  }
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  return clientMetadata(origin)
})
