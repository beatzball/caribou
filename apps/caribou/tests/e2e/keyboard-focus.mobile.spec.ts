import { test } from './_fixtures.js'
import { phoneFocus } from './_keyboard-focus.js'

for (const theme of ['dark', 'light']) {
  for (const network of ['mastodon', 'bluesky']) {
    test(`rule 1: phone keyboard focus clears navigation (${theme}, ${network})`, async ({ page, browserName }) => {
      await phoneFocus(page, browserName, theme, network)
    })
  }
}
