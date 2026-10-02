import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { fetchPublicTimeline } from '../server/lib/mastodon-public.js'
import { getStorage } from '../server/lib/storage.js'
import type { TimelinePageData, ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-timeline.js'
import '../components/caribou-auth-required.js'

export type LocalPageData = TimelinePageData & { shell: ShellInfo }

export const pageData = definePageData<LocalPageData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const raw = await fetchPublicTimeline({
      instance: resolution.instance, kind: 'local', maxId,
    })
    // Pre-sanitize at the SSR boundary so the JS-disabled user sees clean
    // markup; the server render cannot run DOMPurify itself (it has no
    // window). Dynamic import keeps the jsdom-backed sanitizer out of the
    // client bundle — the fetcher never runs on the client.
    const { sanitizeStatus } = await import('../server/lib/sanitize.js')
    const statuses = raw.map((s) => sanitizeStatus(s))
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return { kind: 'ok', statuses, nextMaxId, shell }
  } catch (err) {
    return { kind: 'error', message: String(err), shell }
  }
})

@customElement('page-local')
export class LocalPage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: var(--space-4); color: var(--fg-muted); }
    litro-link { color: var(--accent); text-decoration-line: underline; }
  `]

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null } }) as LocalPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-auth-required
            label="/local needs to know which instance to query. Sign in once and Caribou will remember."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">
            Couldn't load /local. <litro-link href="/local">Retry</litro-link>
          </article>
        </caribou-app-shell>
      `
    }
    // `data` carries `statuses` and `nextMaxId`, and keeps one identity for
    // the life of the page, so the timeline's `initial` never changes.
    return html`
      <caribou-app-shell instance=${inst}>
        <caribou-timeline kind="local" .initial=${data}></caribou-timeline>
      </caribou-app-shell>
    `
  }
}

export default LocalPage
