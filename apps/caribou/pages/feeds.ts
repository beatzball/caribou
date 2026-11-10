import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { activeClient } from '@beatzball/caribou-state'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-feeds.js'

export interface FeedsData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<FeedsData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  return { kind: 'auth-required', shell: shellInfo(resolution) }
})

@customElement('page-feeds')
export class FeedsPage extends LitroPage {
  static override styles = [pageReset, css`
    .other { padding: var(--space-4); }
    h1 { font-size: 1.5rem; margin: 0 0 var(--space-3); }
    p { color: var(--fg-1); margin: 0; }
  `]

  // Saved feeds are in the reader's Bluesky prefs: only the token in the
  // browser can read them. Like /lists, the server renders the placeholder
  // and the page renders the feeds after `firstUpdated` has read the session.
  @state() private reader: 'none' | 'bluesky' | 'other' = 'none'

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    const signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
    this.reader = !signedIn ? 'none'
      : activeClient.peek()?.capabilities?.network === 'bluesky' ? 'bluesky' : 'other'
  }

  private renderBody() {
    if (this.reader === 'bluesky') return html`<caribou-feeds></caribou-feeds>`
    if (this.reader === 'other') {
      return html`<article class="other"><h1>Feeds</h1>
        <p>Feeds are a Bluesky feature. Switch to a Bluesky account to see your saved feeds.</p></article>`
    }
    return html`<caribou-auth-required
      label="/feeds shows your saved Bluesky feeds. It requires a Bluesky sign-in, which Caribou keeps on your device."
    ></caribou-auth-required>`
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as FeedsData
    return html`
      <caribou-app-shell instance=${data.shell.instance ?? ''}>
        ${this.renderBody()}
      </caribou-app-shell>
    `
  }
}

export default FeedsPage
