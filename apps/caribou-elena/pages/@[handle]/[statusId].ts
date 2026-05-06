import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getRequestURL, getRouterParams } from 'h3'
import { resolveInstanceForRoute } from '../../server/lib/resolve-instance.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'
import { getStorage } from '../../server/lib/storage.js'
import type { ThreadPageData, ShellInfo } from '../../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-thread.js'
import '../components/caribou-auth-required.js'

export type StatusPageData = ThreadPageData & {
  shell: ShellInfo
  statusId: string
  handle: string
}

export const pageData = definePageData<StatusPageData>(async (event) => {
  const params = getRouterParams(event) as { handle?: string; statusId?: string }
  const handle = String(params.handle ?? '')
  const statusId = String(params.statusId ?? '')
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, { handle }, { storage: getStorage(), origin })
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) {
    return { kind: 'auth-required', shell, statusId, handle } as StatusPageData
  }
  const [focusedR, contextR] = await Promise.allSettled([
    fetchStatus(statusId, { instance: resolution.instance }),
    fetchThreadContext(statusId, { instance: resolution.instance }),
  ])
  if (focusedR.status === 'rejected') {
    return { kind: 'error', message: String(focusedR.reason), shell, statusId, handle } as StatusPageData
  }
  const ancestors = contextR.status === 'fulfilled' ? contextR.value.ancestors : []
  const descendants = contextR.status === 'fulfilled' ? contextR.value.descendants : []
  return {
    kind: 'ok',
    focused: focusedR.value, ancestors, descendants,
    shell, statusId, handle,
  } as StatusPageData
})

export default class HandleStatusPage extends LitroPage {
  static override tagName = 'page-handle-status'

  override updated() {
    const data = this.serverData as StatusPageData | null
    if (!data || data.kind !== 'ok') return
    const thread = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-thread')
    if (!thread || thread.initial !== undefined) return
    thread.initial = {
      focused: data.focused,
      ancestors: data.ancestors,
      descendants: data.descendants,
    }
  }

  override render() {
    const data = (this.serverData ?? {
      kind: 'auth-required', shell: { instance: null }, statusId: '', handle: '',
    }) as StatusPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance="${inst}">
          <caribou-auth-required
            label="Threads by bare handle need to know which instance to query."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance="${inst}">
          <article class="p-4 fg-muted" role="alert">
            Couldn't load status ${data.statusId}.
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-thread status-id="${data.statusId}"></caribou-thread>
      </caribou-app-shell>
    `
  }
}
HandleStatusPage.define()
