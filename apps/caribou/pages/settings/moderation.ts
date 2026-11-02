import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { shellInfo } from '../../server/lib/shell-info.js'
import { getStorage } from '../../server/lib/storage.js'
import type { ShellInfo } from '../../server/lib/page-data-types.js'
import '../../components/caribou-app-shell.js'
import '../../components/caribou-auth-required.js'
import '../../components/caribou-moderation-settings.js'

export interface ModerationData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<ModerationData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: shellInfo(resolution) }
})

@customElement('page-settings-moderation')
export class SettingsModerationPage extends LitroPage {
  // The lists need the access token, which only the browser has. Like
  // /bookmarks, the server renders the placeholder and the page renders
  // the lists after `firstUpdated` has read the session.
  @state() private signedIn = false

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as ModerationData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.signedIn
          ? html`<caribou-moderation-settings></caribou-moderation-settings>`
          : html`<caribou-auth-required
              label="/settings/moderation lists your filters and the accounts you mute or block. It requires a Mastodon access token, which Caribou keeps on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default SettingsModerationPage
