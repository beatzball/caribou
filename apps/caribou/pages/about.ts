import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import { PACKAGE_VERSION } from '../server/build-meta.generated.js'
import '../components/caribou-app-shell.js'

export interface AboutData { shell: ShellInfo }

export const pageData = definePageData<AboutData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { shell: { instance: resolution.instance } }
})

@customElement('page-about')
export class AboutPage extends LitroPage {
  static override styles = [pageReset, css`
    article { color: var(--fg-1); padding: 1rem; max-width: 640px; }
    h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; margin-bottom: 1rem; }
  `]

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as AboutData
    const inst = data.shell.instance ?? ''
    return html`
      <caribou-app-shell instance=${inst}>
        <article>
          <h1>About</h1>
          <p>Caribou — A Mastodon client built on Litro. Version ${PACKAGE_VERSION}.</p>
        </article>
      </caribou-app-shell>
    `
  }
}

export default AboutPage
