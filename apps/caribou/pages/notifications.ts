import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-notifications.js'

export interface NotificationsData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<NotificationsData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: { instance: resolution.instance } }
})

@customElement('page-notifications')
export class NotificationsPage extends LitroPage {
  // As on /home: the server cannot know who is signed in, so it renders the
  // placeholder, and the list replaces it once `firstUpdated` has read the
  // session.
  @state() private signedIn = false

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as NotificationsData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.signedIn
          ? html`<caribou-notifications></caribou-notifications>`
          : html`<caribou-auth-required
              label="/notifications shows who replied to, boosted, favourited or followed you. It requires a Mastodon access token, which Caribou keeps on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default NotificationsPage
