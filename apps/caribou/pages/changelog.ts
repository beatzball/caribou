import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { shellInfo } from '../server/lib/shell-info.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import { versionAnchor, type Block, type Inline, type Item, type Release } from '../server/lib/changelog.js'
import { PACKAGE_VERSION } from '../server/build-meta.generated.js'
import { markChangelogSeen } from '../components/_changelog-seen.js'
import '../components/caribou-app-shell.js'

export interface ChangelogData { shell: ShellInfo; releases: Release[] }

export const pageData = definePageData<ChangelogData>(async (event) => {
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage() })
  // A dynamic import keeps the changelog text out of the client bundle.
  const { changelogReleases } = await import('../server/lib/changelog-data.js')
  return { shell: shellInfo(resolution), releases: changelogReleases() }
})

// The file's content is only ever text in these templates: Lit escapes
// every binding, and the parser lets through only http(s) links.
function renderInline(nodes: Inline[]): unknown[] {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return n.v
      case 'code': return html`<code>${n.v}</code>`
      case 'strong': return html`<strong>${renderInline(n.c)}</strong>`
      case 'link': return html`<a href=${n.href} rel="noopener">${renderInline(n.c)}</a>`
    }
  })
}

function renderBlocks(blocks: Block[], pr?: Item['pr']): TemplateResult[] {
  return blocks.map((b, i) => b.t === 'p'
    ? html`<p>${renderInline(b.c)}${i === 0 && pr
      ? html` <a class="pr" href=${pr.href} rel="noopener"
          aria-label=${`Pull request ${pr.number}`}>#${pr.number}</a>` : nothing}</p>`
    : html`<ul>${b.items.map((it) => html`<li>${renderBlocks(it.blocks, it.pr)}</li>`)}</ul>`)
}

@customElement('page-changelog')
export class ChangelogPage extends LitroPage {
  static override styles = [pageReset, css`
    article { color: var(--fg-1); padding: 1rem; max-width: 640px; }
    h1 { font-size: 1.5rem; line-height: 2rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--fg-0); }
    .running { margin-bottom: 1.5rem; }
    section { border-top: 1px solid var(--border); padding: 0.75rem 0; }
    summary { cursor: pointer; display: flex; align-items: baseline; gap: 0.5rem; }
    summary::-webkit-details-marker { display: none; }
    /* Generated content is read out, so the glyph is in an aria-hidden span. */
    .marker::before { content: '▸'; color: var(--fg-1); }
    details[open] > summary .marker::before { content: '▾'; }
    h2 { display: inline; font-size: 1.125rem; font-weight: 600; color: var(--fg-0); }
    h3 { font-size: 0.875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin: 1rem 0 0.25rem; }
    ul { padding-left: 1.25rem; margin: 0.25rem 0; list-style: disc; }
    li { margin: 0.5rem 0; }
    li ul { margin-top: 0.25rem; }
    p + p, p + ul, ul + p { margin-top: 0.5rem; }
    a { color: var(--accent); overflow-wrap: anywhere; }
    .pr, .permalink { color: var(--fg-1); font-size: 0.875em; }
    .permalink { display: inline-block; margin-top: 0.5rem; }
    code { font-family: ui-monospace, monospace; font-size: 0.875em; overflow-wrap: anywhere; }
    .empty { margin-top: 0.5rem; }
  `]

  private _onHashChange = () => { this.openHashTarget()?.scrollIntoView() }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('hashchange', this._onHashChange)
  }

  override disconnectedCallback() {
    window.removeEventListener('hashchange', this._onHashChange)
    super.disconnectedCallback()
  }

  protected override firstUpdated(changed: Map<PropertyKey, unknown>) {
    super.firstUpdated?.(changed)
    // Opening the page is reading it: the unread dot goes away.
    markChangelogSeen()
    this.openHashTarget()
  }

  // A link to a closed version (`/changelog#v0-9-0`) opens it. On a full
  // load the browser has scrolled to the section by then. A hash change on
  // this page does not scroll (the section is in the page's shadow root),
  // so the hashchange handler scrolls to the section it returns.
  private openHashTarget(): Element | null {
    const id = window.location.hash.slice(1)
    if (!id) return null
    const section = this.renderRoot.querySelector(`section[id="${CSS.escape(id)}"]`)
    const details = section?.querySelector('details')
    if (details) details.open = true
    return section ?? null
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null }, releases: [] }) as ChangelogData
    const inst = data.shell.instance ?? ''
    return html`
      <caribou-app-shell instance=${inst}>
        <article>
          <h1>Changelog</h1>
          <p class="running">You are using version ${PACKAGE_VERSION}.</p>
          ${data.releases.map((r, i) => this.renderRelease(r, i === 0))}
        </article>
      </caribou-app-shell>
    `
  }

  private renderRelease(r: Release, latest: boolean) {
    const id = versionAnchor(r.version)
    return html`<section id=${id} aria-labelledby=${`${id}-title`}>
      <details ?open=${latest}>
        <summary><span class="marker" aria-hidden="true"></span><h2 id=${`${id}-title`}>Version ${r.version}</h2></summary>
        <div>
          ${r.groups.length
            ? r.groups.map((g) => html`<h3>${g.title}</h3><ul>${g.items.map((it) =>
                html`<li>${renderBlocks(it.blocks, it.pr)}</li>`)}</ul>`)
            : html`<p class="empty">Internal changes only.</p>`}
          <a class="permalink" href=${`#${id}`}>Link to version ${r.version}</a>
        </div>
      </details>
    </section>`
  }
}

export default ChangelogPage
