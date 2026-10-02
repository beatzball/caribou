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

export type PublicPageData = TimelinePageData & { shell: ShellInfo }

export const pageData = definePageData<PublicPageData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  const shell: ShellInfo = { instance: resolution.instance }
  if (!resolution.instance) return { kind: 'auth-required', shell }
  const query = getQuery(event)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const raw = await fetchPublicTimeline({
      instance: resolution.instance, kind: 'public', maxId,
    })
    // Dynamic import keeps jsdom out of the client bundle (see local.ts).
    const { sanitizeStatus } = await import('../server/lib/sanitize.js')
    const statuses = raw.map((s) => sanitizeStatus(s))
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return { kind: 'ok', statuses, nextMaxId, shell }
  } catch (err) {
    return { kind: 'error', message: String(err), shell }
  }
})

@customElement('page-public')
export class PublicPage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: var(--space-4); color: var(--fg-muted); }
    litro-link { color: var(--accent); text-decoration-line: underline; }
  `]

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null } }) as PublicPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-auth-required
            label="/public needs to know which instance to query. Sign in once and Caribou will remember."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">
            Couldn't load /public. <litro-link href="/public">Retry</litro-link>
          </article>
        </caribou-app-shell>
      `
    }
    // `data` carries `statuses` and `nextMaxId`, and keeps one identity for
    // the life of the page, so the timeline's `initial` never changes.
    return html`
      <caribou-app-shell instance=${inst}>
        <caribou-timeline kind="public" .initial=${data}></caribou-timeline>
      </caribou-app-shell>
    `
  }
}

export default PublicPage
