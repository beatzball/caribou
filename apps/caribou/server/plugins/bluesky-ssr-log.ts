import { defineNitroPlugin } from 'nitropack/runtime'
import { blueskySsrStartupLine } from '../lib/bluesky-flag.js'

// Say once, at start, whether the kill switch is on, so an operator who set
// `BLUESKY_SSR` can see that the server read it (README, "Bluesky SSR").
// `warn`: the lint rule allows only `warn` and `error`, and both reach the log.
export default defineNitroPlugin(() => {
  console.warn(blueskySsrStartupLine())
})
