import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { activeUserKey, storageWorks } from '@beatzball/caribou-state'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-settings.js'

export interface SettingsData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<SettingsData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: shellInfo(resolution) }
})

@customElement('page-settings')
export class SettingsPage extends LitroPage {
  // The settings are per account and live in the browser
  // (`caribou.prefs.<userKey>`). Like /bookmarks, the server renders the
  // placeholder, and the page renders the settings after `firstUpdated` has
  // read the session. The sections are then new elements, not hydrated ones,
  // so they may read storage when they connect.
  //
  // It reads the session from `activeUserKey`, which `loadFromStorage` has
  // already checked, and never touches storage itself: a throw here would
  // reject the page's update, and the router would never show it. With
  // storage blocked there is no session, but the page still shows the
  // defaults, with a note that they cannot be saved.
  @state() private signedIn = false
  @state() private storageBlocked = false

  protected override firstUpdated() {
    this.storageBlocked = !storageWorks()
    this.signedIn = activeUserKey.peek() !== null
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as SettingsData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.signedIn || this.storageBlocked
          ? html`<caribou-settings ?storage-blocked=${this.storageBlocked}></caribou-settings>`
          : html`<caribou-auth-required
              label="/settings holds the settings of your account. Caribou keeps them on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default SettingsPage
