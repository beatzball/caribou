import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getQuery, getRequestURL, getRouterParams } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../server/lib/mastodon-public.js'
import { getStorage } from '../server/lib/storage.js'
import type { ProfilePageData, ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-profile.js'
import './components/caribou-auth-required.js'

type Tab = 'posts' | 'replies' | 'media'

function parseTab(raw: unknown): Tab {
  return raw === 'replies' || raw === 'media' ? raw : 'posts'
}

export type HandlePageData = ProfilePageData & { shell: ShellInfo; handle: string }

export const pageData = definePageData<HandlePageData>(async (event) => {
  const params = getRouterParams(event) as { handle?: string }
  const handle = String(params.handle ?? '')
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, { handle }, { storage: getStorage(), origin })
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell, handle } as HandlePageData
  const query = getQuery(event)
  const tab = parseTab(query.tab)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const account = await fetchAccountByHandle(handle, { instance: resolution.instance })
    const statuses = await fetchAccountStatuses(account.id, {
      instance: resolution.instance,
      tab,
      maxId,
    })
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return { kind: 'ok', account, statuses, nextMaxId, tab, shell, handle } as HandlePageData
  } catch (err) {
    return { kind: 'error', message: String(err), shell, handle } as HandlePageData
  }
})

export default class HandlePage extends LitroPage {
  static override tagName = 'page-handle'

  override updated() {
    const data = this.serverData as HandlePageData | null
    if (!data || data.kind !== 'ok') return
    const profile = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-profile')
    if (!profile || profile.initial !== undefined) return
    profile.initial = {
      account: data.account,
      statuses: data.statuses,
      nextMaxId: data.nextMaxId,
      tab: data.tab,
    }
  }

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null }, handle: '' }) as HandlePageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance="${inst}">
          <caribou-auth-required
            label="Profiles by bare handle (@user without @host) need to know which instance to query."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance="${inst}">
          <article class="p-4 fg-muted" role="alert">
            Couldn't load profile @${data.handle}.
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-profile handle="${data.handle}" tab="${data.tab}"></caribou-profile>
      </caribou-app-shell>
    `
  }
}
HandlePage.define()
