import { html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery } from 'h3'
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
  override render() {
    const data = (this.serverData ?? { add: false }) as IndexData
    return html`
      <caribou-landing ?add=${data.add}></caribou-landing>
    `
  }
}

export default IndexPage
