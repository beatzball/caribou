import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage, pageReset, type LitroLocation } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getRouterParams } from 'h3'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import { shellInfo } from '../../server/lib/shell-info.js'
import { getStorage } from '../../server/lib/storage.js'
import type { ShellInfo } from '../../server/lib/page-data-types.js'
import '../../components/caribou-app-shell.js'
import '../../components/caribou-auth-required.js'
import '../../components/caribou-timeline.js'
import '../../components/caribou-list-header.js'
import { enterWithCache } from '../../components/_page-cache.js'
import { parseListId } from '../../components/_list-path.js'

// `id` is null for a path segment no list id can be, so no request goes
// out for it.
export interface ListPageData {
  kind: 'auth-required' | 'not-found'
  shell: ShellInfo
  id: string | null
}

export const pageData = definePageData<ListPageData>(async (event) => {
  const raw = String((getRouterParams(event) as { id?: string }).id ?? '')
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  const id = parseListId(raw)
  return { kind: id === null ? 'not-found' : 'auth-required', shell: shellInfo(resolution), id }
})

@customElement('page-lists-id')
export class ListPage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: var(--space-4); color: var(--fg-muted); }
  `]

  // A list needs the reader's session, which lives only in the browser,
  // so the server cannot paint its posts or even its title. Like /home, the
  // server renders the placeholder; the first client render repeats it, and
  // `firstUpdated` then reads the session and renders the list.
  @state() private signedIn = false

  protected override firstUpdated() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    this.signedIn = !!meRaw && meRaw !== 'null' && meRaw !== '""'
  }

  // A revisit paints from the kept timeline at once. The page data is only
  // the shell, so there is nothing to fetch again (`enterWithCache`).
  override onBeforeEnter(location: LitroLocation) {
    return enterWithCache(this, location, () => super.onBeforeEnter(location), { refresh: false })
  }

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null }, id: null }) as ListPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'not-found' || !data.id) {
      return html`<caribou-app-shell instance=${inst}><article>This is not a list address.</article></caribou-app-shell>`
    }
    if (!this.signedIn) {
      return html`<caribou-app-shell instance=${inst}>
        <caribou-auth-required
          label="A list's timeline shows posts by the accounts in one of your lists. To see it, sign in. Caribou keeps your sign-in on your device."
        ></caribou-auth-required>
      </caribou-app-shell>`
    }
    return html`<caribou-app-shell instance=${inst}>
      <div>
        <caribou-list-header list=${data.id}></caribou-list-header>
        <caribou-timeline kind="list" list=${data.id}></caribou-timeline>
      </div>
    </caribou-app-shell>`
  }
}

export default ListPage
