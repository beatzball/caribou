import { defineNitroPlugin } from 'nitropack/runtime'
import { getRequestURL, setResponseHeader } from 'h3'
import { entryCacheControl } from '../lib/app-entry.js'

// Nitro serves `/_litro/app.js` from its static handler, which runs before
// any server middleware, and the route rule sets `no-cache` before that. The
// response hook is the one place left that sees the request after both.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const url = getRequestURL(event)
    const cacheControl = entryCacheControl(url.pathname, url.searchParams)
    if (cacheControl) setResponseHeader(event, 'cache-control', cacheControl)
  })
})
