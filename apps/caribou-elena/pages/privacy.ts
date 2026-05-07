import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getRequestURL } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'

export interface PrivacyData { shell: ShellInfo }

export const pageData = definePageData<PrivacyData>(async (event) => {
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage(), origin })
  return { shell: { instance: resolution.instance } }
})

export default class PrivacyPage extends LitroPage {
  static override tagName = 'page-privacy'

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as PrivacyData
    const inst = data.shell.instance ?? ''
    return html`
      <caribou-app-shell instance="${inst}">
        <article class="prose fg-1 p-4 max-w-[640px]">
          <h1 class="text-2xl font-semibold mb-4">Privacy</h1>
          <p>
            Privacy policy coming soon. Caribou does not collect analytics or
            telemetry. Your Mastodon instance sees your activity; Caribou's
            server proxies unauthenticated public reads (timelines, profiles,
            threads) on your behalf and stores a hostname-only
            <code>caribou.instance</code> cookie when you sign in so bare-URL
            profile views know which instance to query — your access token and
            post content stay on your device.
          </p>
        </article>
      </caribou-app-shell>
    `
  }
}
PrivacyPage.define()
