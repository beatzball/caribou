import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getRequestURL } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import { PACKAGE_VERSION } from '../server/build-meta.generated.js'
import './components/caribou-app-shell.js'

export interface AboutData { shell: ShellInfo }

export const pageData = definePageData<AboutData>(async (event) => {
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage(), origin })
  return { shell: { instance: resolution.instance } }
})

export default class AboutPage extends LitroPage {
  static override tagName = 'page-about'

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as AboutData
    const inst = data.shell.instance ?? ''
    return html`
      <caribou-app-shell instance="${inst}">
        <article class="prose fg-1 p-4 max-w-[640px]">
          <h1 class="text-2xl font-semibold mb-4">About</h1>
          <p>Caribou — A Mastodon client built on Litro. Version ${PACKAGE_VERSION}.</p>
        </article>
      </caribou-app-shell>
    `
  }
}
AboutPage.define()
