import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import type { Account, MediaAttachment, Status } from '@beatzball/caribou-mastodon-client'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
import { effect } from '@preact/signals-core'
import {
  activeClient, activeUser, deletedStatusIds, EDIT_FIELDS, olderEdit, readerFiltered,
  relationshipCache, relationshipKey, statusCache,
} from '@beatzball/caribou-state'
import { findShell } from './_shell.js'
import { accountPath } from './_profile-path.js'
import { spaClick } from './_spa-link.js'
import { hashtagOf, sameUrl } from './_post-links.js'
import { tagPath } from './_tag-path.js'
import { filterVerdict, type FilterContext, type FilterVerdict } from './_status-filter.js'
import { mastodonLinkText } from './_shared-styles.js'

// The same hooks as the server's sanitizer, so the two agree on every string.
if (typeof window !== 'undefined') installPurifyHooks(DOMPurify)

type Quote = NonNullable<Status['quote']>

// The post a quote shows, when the server sent it. A shallow quote (the
// quote inside a quoted post) carries only an id.
function quotedOf(quote: Quote | null | undefined): Status | null {
  if (!quote || quote.state !== 'accepted') return null
  return 'quotedStatus' in quote && quote.quotedStatus ? quote.quotedStatus : null
}

// What a quote that shows no post says, by its state (Mastodon 4.5,
// `Quote.state`). A state this build does not know is "not available".
const STATE_NOTES: Record<string, string> = {
  pending: 'The author of the quoted post has not approved this quote yet.',
  rejected: 'The author of the quoted post declined this quote.',
  revoked: 'The author of the quoted post removed this quote.',
  deleted: 'The quoted post was deleted.',
  unauthorized: 'You cannot see the quoted post.',
  blocked_account: 'Quoted post hidden: you blocked its author.',
  blocked_domain: 'Quoted post hidden: you blocked its author\'s server.',
  muted_account: 'Quoted post hidden: you muted its author.',
}
const NOT_AVAILABLE = 'The quoted post is not available.'

function absoluteLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}

// The same path as the status card's permalink: the thread page.
function threadPath(s: Status): string {
  return `/@${s.account.acct}/${encodeURIComponent(s.id)}`
}

const MEDIA_WORDS: Record<string, [string, string]> = {
  image: ['image', 'images'], video: ['video', 'videos'], gifv: ['GIF', 'GIFs'], audio: ['audio', 'audio'],
}

// "2 images, 1 video, a poll". The quote shows no media itself, so nothing
// loads.
function mediaSummary(media: readonly MediaAttachment[], poll: boolean): string {
  const counts = new Map<string, number>()
  for (const m of media) {
    const kind = MEDIA_WORDS[m.type] ? m.type : 'other'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, n]) => {
    const [one, many] = MEDIA_WORDS[kind] ?? ['attachment', 'attachments']
    return `${n} ${n === 1 ? one : many}`
  }).concat(poll ? ['a poll'] : []).join(', ')
}

function withEdit(post: Status, edit: Status | null): Status {
  if (!edit || edit.id !== post.id) return post
  const out = { ...post } as Record<string, unknown>
  for (const key of EDIT_FIELDS) out[key] = (edit as unknown as Record<string, unknown>)[key]
  return out as unknown as Status
}

function sameVerdict(a: FilterVerdict | null | undefined, b: FilterVerdict | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.action === b.action && a.titles.join('\n') === b.titles.join('\n')
}

/**
 * A quoted post inside `<caribou-status-card>`: author, text, a media
 * summary and a link to its thread, or a short note when the quote shows
 * no post. Display only. A quote inside the quoted post is a link, never
 * another card.
 */
@customElement('caribou-status-quote')
export class CaribouStatusQuote extends LitElement {
  static override styles = [mastodonLinkText, css`
    :host { display: block; margin-top: var(--space-3); }
    .quote, .quote-note {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: var(--space-3); min-width: 0;
    }
    .quote { cursor: pointer; }
    .quote:hover { background: var(--bg-1); }
    .quote-note { margin: 0; color: var(--fg-muted); overflow-wrap: anywhere; }
    .quote-note strong { color: var(--fg-0); }
    header { display: flex; gap: var(--space-2); align-items: baseline; flex-wrap: wrap; min-width: 0; }
    .author {
      display: inline-flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; min-width: 0;
      color: inherit; text-decoration: none; border-radius: var(--radius-sm);
    }
    .author:hover strong { text-decoration: underline; }
    .author img { border-radius: var(--radius-sm); }
    .author strong { color: var(--fg-0); }
    .acct { color: var(--fg-muted); overflow-wrap: anywhere; }
    .permalink { color: var(--fg-muted); font-size: 0.875rem; text-decoration: none; }
    .permalink:hover { text-decoration: underline; }
    a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .quote-content { color: var(--fg-0); margin-top: var(--space-2); }
    .quote-content, .quote-content p, .quote-content a { overflow-wrap: anywhere; word-break: break-word; min-width: 0; }
    .quote-content p { margin: 0 0 var(--space-2); }
    .quote-content p:last-child { margin-bottom: 0; }
    .quote-content a + a { margin-inline-start: 0.25em; }
    /* Mastodon's "RE: <link>" fallback; the nested link stands for it. */
    .quote-content .quote-inline { display: none; }
    .media-summary, .nested { display: block; margin-top: var(--space-2); color: var(--fg-muted); font-size: 0.875rem; }
    .nested { color: var(--accent); }
    .spoiler { margin: var(--space-2) 0 0; color: var(--fg-0); white-space: pre-wrap; overflow-wrap: anywhere; }
    .notice { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
    .notice p { margin: 0; flex: 1; }
    .cw-toggle, .filter-toggle {
      margin-top: var(--space-2); padding: var(--space-1) var(--space-3);
      font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer;
      color: var(--fg-0); background: var(--bg-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .filter-toggle { margin-top: 0; }
    .cw-toggle:hover, .filter-toggle:hover { background: var(--bg-1); }
    .filtered-post:not([hidden]) { margin-top: var(--space-3); }
  `]

  @property({ attribute: false }) quote: Quote | null = null
  // The instance the quoting post came from; without it the shell's.
  @property() instance = ''
  // The status card's `filter-context`.
  @property({ attribute: 'filter-context' }) filterContext: FilterContext | '' = ''

  // Everything below starts empty, so the server and the first client
  // render are the same; the effect fills it after mount.
  @state() private shellInstance = ''
  @state() private relativeTime = false
  @state() private liveEdit: Status | null = null
  @state() private deleted = false
  @state() private liveVerdict: FilterVerdict | null | undefined = undefined
  @state() private relWhy: { verb: 'muted' | 'blocked'; acct: string } | null = null
  @state() private warningOpen = false
  @state() private filterShown = false

  private adoptedServerRender = false
  private dispose: (() => void) | null = null

  protected override createRenderRoot() {
    this.adoptedServerRender = this.shadowRoot !== null
    return super.createRenderRoot()
  }

  protected override firstUpdated() {
    this.relativeTime = true
    this.bind()
  }

  override connectedCallback() {
    super.connectedCallback()
    if (this.hasUpdated && !this.dispose) this.bind()
  }

  override disconnectedCallback() {
    this.unbind()
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    // A new copy of the same quoted post (every merge of the quoting post
    // makes one) keeps what the reader opened; another post starts closed.
    const before = changed.get('quote') as Quote | null | undefined
    if (changed.has('quote') && before !== undefined && quotedOf(before)?.id !== quotedOf(this.quote)?.id) {
      this.warningOpen = false
      this.filterShown = false
    }
    if ((changed.has('quote') || changed.has('instance') || changed.has('filterContext')) && this.dispose) {
      this.unbind()
      this.bind()
    }
  }

  private unbind() {
    this.dispose?.()
    this.dispose = null
  }

  // The status cache, the deleted marks and the relationships are the
  // reader's server's, so they count only for a quote from that server.
  private bind() {
    this.shellInstance = findShell(this)?.getAttribute('instance') ?? ''
    this.dispose = effect(() => {
      const user = activeUser.value
      const client = activeClient.value
      const q = quotedOf(this.quote)
      const instance = this.instance || this.shellInstance
      const same = !!client && !!user && (!instance || user.server.toLowerCase() === instance.toLowerCase())
      const cached = q && same ? statusCache.value.get(q.id) : undefined
      const edit = q && cached && olderEdit(q, cached) ? cached : null
      if (edit !== this.liveEdit) this.liveEdit = edit
      const deleted = same && !!q && deletedStatusIds.value.has(q.id)
      if (deleted !== this.deleted) this.deleted = deleted
      const own = same && !!q && user?.account?.id === q.account.id
      const filtered = q ? readerFiltered(q.id) : undefined
      const source = q && filtered ? { ...q, filtered: filtered as Status['filtered'] } : q
      const verdict = source && !own ? filterVerdict(source, this.filterContext || null) : null
      if (!sameVerdict(verdict, this.liveVerdict)) this.liveVerdict = verdict
      const rel = q && same && user ? relationshipCache.value.get(relationshipKey(user.userKey, q.account.id)) : undefined
      const verb = rel?.blocking === true ? 'blocked' : rel?.muting === true ? 'muted' : null
      const why = verb && q ? { verb, acct: q.account.acct } as const : null
      if (why?.verb !== this.relWhy?.verb || why?.acct !== this.relWhy?.acct) this.relWhy = why
    })
  }

  private profileHref(account: { acct: string; url?: string | null } & Pick<Account, 'bluesky'>): string {
    return accountPath(account, this.instance || this.shellInstance || hostOf(account.url ?? ''))
  }

  // As in the status card: the server pre-sanitizes, the hydrating render
  // trusts the string already in the DOM, and every later render cleans it.
  private safeContent(content: string): string {
    if (typeof window === 'undefined') return content
    if (this.adoptedServerRender && !this.hasUpdated) return content
    return DOMPurify.sanitize(content, PURIFY_OPTS)
  }

  // A plain click anywhere on the card opens the thread, like a click on
  // its time. Links, buttons and a text selection keep their own meaning.
  private onCardClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const target = e.composedPath()[0] as Element | undefined
    if (target?.closest?.('a, button')) return
    if (typeof window !== 'undefined' && (window.getSelection?.()?.toString() ?? '') !== '') return
    const q = quotedOf(this.quote)
    if (!q) return
    const href = threadPath(q)
    void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(href))
  }

  // As in the status card: a plain click on a hashtag the post lists, or a
  // mention it names, opens Caribou's own page. The href stays the server's.
  private onContentClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element).closest?.('a')
    const q = quotedOf(this.quote)
    if (!a || !q) return
    const display = withEdit(q, this.liveEdit)
    const tag = hashtagOf(a, display.tags)
    const mention = tag || !a.matches('.mention') ? undefined : display.mentions?.find((m) => sameUrl(m.url, a.href))
    const href = tag ? tagPath(tag) : mention ? this.profileHref(mention) : null
    if (!href) return
    e.preventDefault()
    void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(href))
  }

  private onToggleWarning = () => { this.warningOpen = !this.warningOpen }
  private onToggleFiltered = () => { this.filterShown = !this.filterShown }

  override render() {
    const quote = this.quote
    if (!quote) return nothing
    const q = quotedOf(quote)
    if (!q || this.deleted) {
      const note = this.deleted ? STATE_NOTES.deleted : STATE_NOTES[quote.state] ?? NOT_AVAILABLE
      // An accepted quote whose post the server left out.
      return html`<p class="quote-note">${quote.state === 'accepted' && !this.deleted ? NOT_AVAILABLE : note}</p>`
    }
    if (this.relWhy) {
      return html`<p class="quote-note">Quoted post hidden: you ${this.relWhy.verb} @${this.relWhy.acct}.</p>`
    }
    const verdict = this.liveVerdict !== undefined ? this.liveVerdict : filterVerdict(q, this.filterContext || null)
    if (verdict?.action === 'hide') {
      return html`<p class="quote-note">The quoted post is hidden by a filter.</p>`
    }
    if (verdict) {
      const titles = verdict.titles.join(', ')
      const shown = this.filterShown
      // Native: its aria-controls names a region in this root.
      return html`<div class="quote-note">
        <div class="notice">
          <p>Hidden by filter: <strong>${titles}</strong></p>
          <button type="button" class="filter-toggle" aria-controls="quote-filtered"
            aria-expanded=${shown ? 'true' : 'false'}
            aria-label=${`${shown ? 'Hide' : 'Show'} quoted post hidden by filter: ${titles}`}
            @click=${this.onToggleFiltered}>${shown ? 'Hide' : 'Show'}</button>
        </div>
        <div class="filtered-post" id="quote-filtered" ?hidden=${!shown}>${shown ? this.renderQuoted(q) : nothing}</div>
      </div>`
    }
    return this.renderQuoted(q)
  }

  private renderQuoted(quoted: Status) {
    const display = withEdit(quoted, this.liveEdit)
    const dt = display.createdAt
    const when = this.relativeTime ? formatRelativeTime(dt) : absoluteLabel(dt)
    const name = display.account.displayName || display.account.username
    const warning = display.spoilerText ?? ''
    const bodyShown = warning === '' || this.warningOpen
    const media = display.mediaAttachments ?? []
    const thread = threadPath(display)
    // One element around it all: happy-dom drops a child binding at the top
    // level of a template (README, Tests).
    return html`<div class="quote" role="group" aria-label=${`Quoted post by ${name}`} @click=${this.onCardClick}>
      <header>
        <a class="author" href=${this.profileHref(display.account)} @click=${spaClick}>
          <img class="avatar" src=${display.account.avatarStatic || display.account.avatar}
               alt="" width="20" height="20" loading="lazy" decoding="async" />
          <strong>${name}</strong>
          <span class="acct">@${display.account.acct}</span>
        </a>
        <a class="permalink" href=${thread} @click=${spaClick}><time datetime=${dt}>${when}</time></a>
      </header>
      ${warning
        ? html`<p class="spoiler">${warning}</p>
            <button type="button" class="cw-toggle" aria-controls="quote-body"
              aria-expanded=${this.warningOpen ? 'true' : 'false'}
              aria-label=${this.warningOpen ? 'Show less of the quoted post' : 'Show more of the quoted post'}
              @click=${this.onToggleWarning}>${this.warningOpen ? 'Show less' : 'Show more'}</button>`
        : nothing}
      <div class="quote-body" id="quote-body" ?hidden=${!bodyShown}>
        ${bodyShown ? html`<div class="quote-content" @click=${this.onContentClick}>${unsafeHTML(this.safeContent(display.content ?? ''))}</div>` : nothing}
        ${bodyShown && (media.length || display.poll)
          ? html`<span class="media-summary">${mediaSummary(media, !!display.poll)}${media.length && display.sensitive ? ' (marked sensitive)' : ''}</span>`
          : nothing}
        ${bodyShown && display.quote?.state === 'accepted'
          ? html`<a class="nested" href=${thread} @click=${spaClick}>This post quotes another post. Open it to see the quote.</a>`
          : nothing}
      </div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-status-quote': CaribouStatusQuote }
}
