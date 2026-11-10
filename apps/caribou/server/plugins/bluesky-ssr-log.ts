import { defineNitroPlugin } from 'nitropack/runtime'
import { blueskySsrStartupLine } from '../lib/bluesky-flag.js'

// Say once, at start, whether the kill switch is on, so an operator who set
// `BLUESKY_SSR` can see that the server read it (README, "Bluesky SSR").
export default defineNitroPlugin(() => {
  // Info, not warn: "on" is the normal state, and a warning on every start
  // would set off log alerts.
  // eslint-disable-next-line no-console
  console.info(blueskySsrStartupLine())
})
