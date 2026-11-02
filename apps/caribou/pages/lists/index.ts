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
import '../../components/caribou-lists.js'

export interface ListsData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<ListsData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: shellInfo(resolution) }
})

@customElement('page-lists')
export class ListsPage extends LitroPage {
  // Lists are private: only the access token in the browser can read them.
  // Like /bookmarks, the server renders the placeholder and the page
  // renders the lists after `firstUpdated` has read the session.
  @state() private signedIn = false

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as ListsData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.signedIn
          ? html`<caribou-lists></caribou-lists>`
          : html`<caribou-auth-required
              label="/lists shows your lists. It requires a Mastodon access token, which Caribou keeps on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default ListsPage
