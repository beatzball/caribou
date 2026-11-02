import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery } from 'h3'
import type { SearchType } from '@beatzball/caribou-mastodon-client'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-search.js'
import { parseSearch } from '../components/_search-query.js'

export interface SearchPageData {
  shell: ShellInfo
  q: string
  type: SearchType
}

// The server sends only the query: who is reading lives in the browser, and
// a signed-in reader searches with their own token. So the server and the
// first client render both show "Searching…", and the element searches
// after mount.
export const pageData = definePageData<SearchPageData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  const { q, type } = parseSearch(getQuery(event) as Record<string, unknown>)
  return { shell: shellInfo(resolution), q, type }
})

@customElement('page-search')
export class SearchPage extends LitroPage {
  static override styles = [pageReset, css`
    h1 { font-size: 1.25rem; margin: 0; padding: 0 var(--space-3) var(--space-3); color: var(--fg-0); }
  `]

  override render() {
    const data = (this.serverData ?? { shell: { instance: null }, q: '', type: 'accounts' }) as SearchPageData
    const inst = data.shell.instance ?? ''
    return html`
      <caribou-app-shell instance=${inst}>
        <div>
          <h1>Search</h1>
          <caribou-search q=${data.q} type=${data.type} instance=${inst}></caribou-search>
        </div>
      </caribou-app-shell>
    `
  }
}

export default SearchPage
