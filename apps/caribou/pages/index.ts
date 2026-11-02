import { html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import type { LitroLocation } from '@beatzball/litro-router'
import { definePageData } from '@beatzball/litro'
import { getQuery } from 'h3'
import { FORWARD_ATTR, forwardsToHome, replaceWithHome } from '../components/_root-forward.js'
import '../components/caribou-landing.js'

export interface IndexData {
  // `/?add`: a signed-in reader adds another account (the account menu's
  // "Add account" link). The server sees the query, so it renders the same
  // heading as the client.
  add: boolean
}

export const pageData = definePageData<IndexData>(async (event) => ({
  add: getQuery(event).add !== undefined,
}))

@customElement('page-index')
export class IndexPage extends LitroPage {
  // With an active account, `/` is `/home` (issue 135). On a full load the
  // head script has already started that navigation, before the first paint;
  // then there is nothing more to do here. This covers a client-side
  // navigation to `/`.
  override onBeforeEnter(location: LitroLocation) {
    if (!document.documentElement.hasAttribute(FORWARD_ATTR)) {
      let go = false
      try { go = forwardsToHome(location.search, localStorage, sessionStorage) } catch { /* blocked */ }
      if (go) {
        replaceWithHome()
        return Promise.resolve()
      }
    }
    return super.onBeforeEnter(location)
  }

  override render() {
    const data = (this.serverData ?? { add: false }) as IndexData
    return html`
      <caribou-landing ?add=${data.add}></caribou-landing>
    `
  }
}

export default IndexPage
