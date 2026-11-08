import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import type { Account, MediaAttachment, Status, StatusBluesky } from '@beatzball/caribou-mastodon-client'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
import { effect } from '@preact/signals-core'
import {
  activeClient, activeUser, cacheStatus, deletedStatusIds, EDIT_FIELDS, olderEdit, readSource, readerFiltered,
  relationshipCache, relationshipKey, statusCache,
} from '@beatzball/caribou-state'
import { findShell } from './_shell.js'
import { accountPath, outsidePermalinkName, postPath } from './_profile-path.js'
import { spaClick } from './_spa-link.js'
import { hashtagOf, sameUrl } from './_post-links.js'
import { tagPath } from './_tag-path.js'
import { filterVerdict, type FilterContext, type FilterVerdict } from './_status-filter.js'
import { mastodonLinkText } from './_shared-styles.js'
import './caribou-button.js'
import {
  BLUESKY_RETRY_EVENT, NO_UNAUTHENTICATED_NOTE, UNREADABLE, asksNoUnauthenticated, blueskyDecisionSettled, coverNote,
  currentBlueskyReader, decisionFits, isFailClosed, uiOf,
} from './_bluesky-moderation.js'

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
// Spec 8.3: a Bluesky author asked to be hidden from signed-out readers.
const NO_UNAUTHENTICATED = 'This account asked to be seen only by signed-in readers.'

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

// The same link as the status card's permalink (`postPath`): the thread
// page, the post's own page for a Mastodon post Caribou cannot place, or
// none.
function threadPath(s: Status, host: string): string | null {
  return postPath(s, host)
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
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
    /* A Bluesky avatar label. */
    .author img.blurred { filter: blur(4px); }
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
  // The reader chose Show on a quoted Bluesky post covered by a label.
  @state() private labelShown = false
  // The quoted Bluesky post's `bluesky` field from its newest copy (the
  // status cache first, as in the status card). Undefined until mount.
  @state() private liveBluesky: StatusBluesky | null | undefined = undefined
  // The reader a decision must be made for; null until mount, as on the server.
  @state() private blueskyReaderKey: string | null = null
  // The quoted post's own decision is settled for the reader
  // (`blueskyDecisionSettled`). True until mount, as on the server.
  @state() private blueskySettled = true
  @state() private retrying = false

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
      this.labelShown = false
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
      const same = !!client && !!user && (!instance || (user.server ?? '').toLowerCase() === instance.toLowerCase())
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
      // A Bluesky quote: its newest copy, whoever's server the page is on
      // (an AT URI is the same for every account), and whose decision fits.
      const bluesky = q?.bluesky ? (statusCache.value.get(q.id)?.bluesky ?? q.bluesky) : null
      if (bluesky !== this.liveBluesky) this.liveBluesky = bluesky
      const reader = currentBlueskyReader(client)
      if (reader !== this.blueskyReaderKey) this.blueskyReaderKey = reader
      const settled = blueskyDecisionSettled(bluesky, client)
      if (settled !== this.blueskySettled) this.blueskySettled = settled
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
    const href = threadPath(q, this.instance || this.shellInstance)
    // Only Caribou's own thread page opens in place; an outside page opens
    // from its link, and no link means no thread to open.
    if (!href?.startsWith('/')) return
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
  private onToggleLabel = () => { this.labelShown = !this.labelShown }

  // A quoted Bluesky post Caribou could not judge: ask the session glue to
  // load the definitions again, and fetch the reader's copy of the quoted
  // post into the status cache, which this card reads.
  private onRetry = async () => {
    const q = quotedOf(this.quote)
    if (!q || this.retrying) return
    window.dispatchEvent(new CustomEvent(BLUESKY_RETRY_EVENT, { detail: { id: q.id } }))
    const client = activeClient.peek()
    if (!client || client.capabilities.network !== 'bluesky') return
    const hadFocus = this.shadowRoot?.activeElement?.matches('caribou-button.retry') === true
    this.retrying = true
    try {
      const source = readSource(client.userKey)
      const fresh = await client.fetchStatus(q.id)
      if (activeClient.peek() === client) cacheStatus(fresh, source)
    } catch {
      // Still covered, with Retry.
    } finally {
      this.retrying = false
    }
    // It worked: the Retry is gone, so focus goes to the quote it revealed.
    await this.updateComplete
    const shown = this.renderRoot.querySelector<HTMLElement>('.quote')
    if (!hadFocus || !shown) return
    shown.setAttribute('tabindex', '-1')
    shown.focus()
  }

  // The quoted post's moderation, from its newest copy.
  private liveModeration(q: Status) {
    const live = this.liveBluesky !== undefined ? this.liveBluesky : q.bluesky ?? null
    return live?.moderation
  }

  override render() {
    const quote = this.quote
    if (!quote) return nothing
    const q = quotedOf(quote)
    if (!q || this.deleted) {
      const hidden = 'bluesky' in quote && quote.bluesky?.hidden === 'no-unauthenticated'
      const note = this.deleted ? STATE_NOTES.deleted : hidden ? NO_UNAUTHENTICATED : STATE_NOTES[quote.state] ?? NOT_AVAILABLE
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
    // A quoted Bluesky post: covers compose and the strictest wins (README,
    // "Bluesky views"). The label cover comes first; its Show reveals the
    // filter cover, if any, and that one's Show the post.
    const live = this.liveBluesky !== undefined ? this.liveBluesky : q.bluesky ?? null
    if (live) {
      const reader = this.blueskyReaderKey
      if (reader === null && asksNoUnauthenticated(q.account)) {
        return html`<p class="quote-note">${NO_UNAUTHENTICATED_NOTE}</p>`
      }
      const ui = decisionFits(live.viewerOf, reader) && this.blueskySettled
        ? (live.moderation ? uiOf(live.moderation, 'contentList')! : UNREADABLE)
        : null
      if (ui === null || ui.filter || ui.blur) {
        const note = ui === null ? 'Checking this quoted post against your moderation settings…' : coverNote(ui)
        const canShow = ui !== null && !ui.noOverride
        const shown = canShow && this.labelShown
        // Retry fetches as the reader: with no Bluesky reader there is none.
        const retry = reader !== null && (ui === null || ui.reasons.some(isFailClosed))
        return html`<div class="quote-note">
          <div class="notice">
            <p>Quoted post: <strong>${note}</strong></p>
            ${canShow
              ? html`<button type="button" class="filter-toggle" aria-controls="quote-labeled"
                  aria-expanded=${shown ? 'true' : 'false'}
                  aria-label=${`${shown ? 'Hide' : 'Show'} quoted post with a label: ${note}`}
                  @click=${this.onToggleLabel}>${shown ? 'Hide' : 'Show'}</button>`
              : nothing}
            ${retry
              ? html`<caribou-button class="retry" variant="secondary" ?loading=${this.retrying}
                  @click=${this.onRetry}>Retry<span class="vh"> checking the quoted post</span></caribou-button>`
              : nothing}
          </div>
          ${canShow
            ? html`<div class="filtered-post" id="quote-labeled" ?hidden=${!shown}>${shown ? (verdict ? this.renderVerdict(q, verdict) : this.renderQuoted(q)) : nothing}</div>`
            : nothing}
        </div>`
      }
    }
    if (verdict) return this.renderVerdict(q, verdict)
    return this.renderQuoted(q)
  }

  private renderVerdict(q: Status, verdict: FilterVerdict) {
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

  private renderQuoted(quoted: Status) {
    const display = withEdit(quoted, this.liveEdit)
    const dt = display.createdAt
    const when = this.relativeTime ? formatRelativeTime(dt) : absoluteLabel(dt)
    const name = display.account.displayName || display.account.username
    const warning = display.spoilerText ?? ''
    const bodyShown = warning === '' || this.warningOpen
    const media = display.mediaAttachments ?? []
    const thread = threadPath(display, this.instance || this.shellInstance)
    const inApp = thread?.startsWith('/') ?? false
    // One element around it all: happy-dom drops a child binding at the top
    // level of a template (README, Tests).
    return html`<div class="quote" role="group" aria-label=${`Quoted post by ${name}`} @click=${this.onCardClick}>
      <header>
        <a class="author" href=${this.profileHref(display.account)} @click=${spaClick}>
          <img class=${uiOf(this.liveModeration(display), 'avatar')?.blur ? 'avatar blurred' : 'avatar'} src=${display.account.avatarStatic || display.account.avatar}
               alt="" width="20" height="20" loading="lazy" decoding="async" />
          <strong>${name}</strong>
          <span class="acct">@${display.account.acct}</span>
        </a>
        ${thread === null
          ? html`<span class="permalink"><time datetime=${dt}>${when}</time></span>`
          : inApp
          ? html`<a class="permalink" href=${thread} @click=${spaClick}><time datetime=${dt}>${when}</time></a>`
          : html`<a class="permalink" href=${thread} rel="noopener noreferrer" target="_blank"
              aria-label=${outsidePermalinkName(when)}><time datetime=${dt}>${when}</time></a>`}
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
          ? html`<span class="media-summary">${mediaSummary(media, !!display.poll)}${media.length && (display.sensitive || uiOf(this.liveModeration(display), 'contentMedia')?.blur) ? ' (marked sensitive)' : ''}</span>`
          : nothing}
        ${bodyShown && display.quote?.state === 'accepted' && inApp
          ? html`<a class="nested" href=${thread!} @click=${spaClick}>This post quotes another post. Open it to see the quote.</a>`
          : nothing}
      </div>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-status-quote': CaribouStatusQuote }
}
