import { html, unsafeHTML } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getQuery, getRequestURL } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../server/lib/mastodon-public.js'
import { getStorage } from '../server/lib/storage.js'
import { getServerNowMs } from '../server/lib/server-now.js'
import { renderPopulatedListMount } from '../server/lib/render-populated-list.js'
import type { TimelinePageData, ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-timeline.js'
import './components/caribou-auth-required.js'

export type LocalPageData = TimelinePageData & { shell: ShellInfo }

export const pageData = definePageData<LocalPageData>(async (event) => {
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage(), origin })
  const shell: ShellInfo = { instance: resolution.instance }
  const serverNowMs = getServerNowMs()
  if (!resolution.instance) return { kind: 'auth-required', shell, serverNowMs }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const statuses = await fetchPublicTimeline({
      instance: resolution.instance, kind: 'local', maxId,
    })
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    const populatedListHtml = await renderPopulatedListMount({
      items: statuses.map((s) => ({ status: s, variant: 'timeline' as const })),
      serverNowMs,
    })
    return { kind: 'ok', statuses, nextMaxId, shell, serverNowMs, populatedListHtml }
  } catch (err) {
    return { kind: 'error', message: String(err), shell, serverNowMs }
  }
})

export default class LocalPage extends LitroPage {
  static override tagName = 'page-local'

  override updated() {
    const data = this.serverData as LocalPageData | null
    if (!data || data.kind !== 'ok') return
    const tl = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-timeline')
    if (tl && tl.initial === undefined) {
      tl.initial = { statuses: data.statuses, nextMaxId: data.nextMaxId }
    }
  }

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null } }) as LocalPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance="${inst}">
          <caribou-auth-required
            label="/local needs to know which instance to query. Sign in once and Caribou will remember."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance="${inst}">
          <article class="p-4 fg-muted" role="alert">
            Couldn't load /local. <a href="/local" class="text-accent underline">Retry</a>
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-timeline kind="local">${unsafeHTML(data.populatedListHtml)}</caribou-timeline>
      </caribou-app-shell>
    `
  }
}
LocalPage.define()
