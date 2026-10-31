import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-timeline.js'

export interface BookmarksData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<BookmarksData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: shellInfo(resolution) }
})

@customElement('page-bookmarks')
export class BookmarksPage extends LitroPage {
  // Bookmarks are private: only the access token in the browser can read
  // them. Like /home, the server renders the placeholder and the page
  // renders the list after `firstUpdated` has read the session.
  //
  // Removing a bookmark here leaves the card in the list with its button
  // off, so a mistaken tap can be undone in place. The next visit no longer
  // lists it.
  @state() private signedIn = false

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as BookmarksData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.signedIn
          ? html`<caribou-timeline kind="bookmarks"></caribou-timeline>`
          : html`<caribou-auth-required
              label="/bookmarks shows the posts you bookmarked. It requires a Mastodon access token, which Caribou keeps on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default BookmarksPage
