import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-timeline.js'

export interface HomeData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<HomeData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: { instance: resolution.instance } }
})

@customElement('page-home')
export class HomePage extends LitroPage {
  // The access token lives only in the browser, so the server cannot know
  // who is signed in: it always renders the placeholder. The first client
  // render repeats that; `firstUpdated` then reads the session and the page
  // renders again with the timeline.
  @state() private signedIn = false

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as HomeData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.signedIn
          ? html`<caribou-timeline kind="home"></caribou-timeline>`
          : html`<caribou-auth-required
              label="/home shows your personal timeline. It requires a Mastodon access token, which Caribou keeps on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default HomePage
