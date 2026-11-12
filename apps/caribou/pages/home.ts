import { readingHeading } from '../components/_shared-styles.js'
import { html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage, type LitroLocation } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { activeClient } from '@beatzball/caribou-state'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-timeline.js'
import '../components/caribou-feed-tabs.js'
import { feedFromSearch } from '../components/_feed-path.js'
import { enterWithCache } from '../components/_page-cache.js'
import { settleSplash } from '../components/_splash.js'

export interface HomeData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<HomeData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: shellInfo(resolution) }
})

@customElement('page-home')
export class HomePage extends LitroPage {
  static override styles = [readingHeading]
  // The access token lives only in the browser, so the server cannot know
  // who is signed in: it always renders the placeholder. The first client
  // render repeats that; `firstUpdated` then reads the session and the page
  // renders again with the timeline.
  @state() private signedIn = false
  // With a Bluesky account active, Home is a row of feed tabs (#194):
  // Following, or the feed `?feed=` names. A Mastodon Home ignores `?feed=`.
  @state() private bluesky = false
  @state() private feed = ''

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
    this.bluesky = this.signedIn && activeClient.peek()?.capabilities?.network === 'bluesky'
    this.feed = this.bluesky ? feedFromSearch(location.search) : ''
    // Signed out, the placeholder is all there is: the loading screen goes.
    // Signed in, the timeline removes it.
    if (!this.signedIn) settleSplash('/home')
  }

  // A revisit paints from the last copy at once. The page data is only the
  // shell, so there is nothing to fetch again; the timeline checks for new
  // posts itself (`enterWithCache`).
  override onBeforeEnter(location: LitroLocation) {
    return enterWithCache(this, location, () => super.onBeforeEnter(location), { refresh: false })
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as HomeData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        <h1 class="reading-heading">Home</h1>
        ${this.signedIn && this.bluesky
          ? html`<caribou-feed-tabs feed=${this.feed}></caribou-feed-tabs>`
          : this.signedIn
          ? html`<caribou-timeline kind="home"></caribou-timeline>`
          : html`<caribou-auth-required
              label="/home shows your personal timeline. It requires a Mastodon access token, which Caribou keeps on your device."
            ></caribou-auth-required>`}
      </caribou-app-shell>
    `
  }
}

export default HomePage
