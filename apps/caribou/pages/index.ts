import { html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, type LitroLocation } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery } from 'h3'
import { DECIDED_ATTR, forwardsToHome, replaceWithHome } from '../components/_root-forward.js'
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
  // With an active account, `/` is `/home` (issue 135). A full load of `/`
  // is decided by the head script, before anything can consume a stashed
  // sign-in error: it either left already or marked `<html>` to stay. So
  // this checks only a client-side navigation to `/`.
  override onBeforeEnter(location: LitroLocation) {
    const root = document.documentElement
    if (root.hasAttribute(DECIDED_ATTR)) {
      root.removeAttribute(DECIDED_ATTR)
    } else {
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
