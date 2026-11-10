import { LitElement, html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { batch, effect } from '@preact/signals-core'
import { searchPublic, type SearchType, type Account, type Search, type Tag } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, isOwnAccount, loadRelationships, mergeStatus, ownerGeneration, readSource,
  relationshipCache, relationshipFor, relationshipKnown, toggleFollow,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { profilePath } from './_profile-path.js'
import { spaClick } from './_spa-link.js'
import { parseTagParam, tagPath } from './_tag-path.js'
import { accountPath } from './_profile-path.js'
import { didOfUserKey, rendersBluesky } from './_bluesky-route.js'
import {
  UNREADABLE, blueskyDecisionSettled, coverNote, currentBlueskyReader, uiOf,
} from './_bluesky-moderation.js'
import {
  SEARCH_TABS, cleanSearch, isUrlQuery, parseSearch, resolvedPath, searchPath,
} from './_search-query.js'
import './caribou-auth-required.js'
import './caribou-button.js'
import './caribou-icon.js'
import './caribou-status-card.js'
import './caribou-tabs.js'


// What the results area shows. `pending` is the server's render and the
// first client one: neither knows yet who is reading, so both say
// "Searching…" for a query.
type Results =
  | { kind: 'empty' }
  | { kind: 'pending' }
  | { kind: 'loading'; q: string }
  | { kind: 'ok'; q: string; data: Search; host: string; signedIn: boolean; resolved: boolean; bluesky: boolean }
  | { kind: 'error'; q: string; message?: string }
  | { kind: 'no-instance' }
  | { kind: 'refused'; q: string }

const DEBOUNCE_MS = 300
const LIMIT = 20

const HINT = 'Search for people, hashtags and posts.'

// Bluesky (README, "Bluesky search and hashtag page").
const CHECKING_PERSON = 'Checking this account against your moderation settings…'
const NO_BLUESKY_TAGS = 'Bluesky does not search hashtags. Type a hashtag name to open its page.'

// One kind of Bluesky result that pages on: what the More button is doing.
type MoreKind = 'accounts' | 'statuses'
interface PersonUi { hide: boolean; cover: string | null; blurAvatar: boolean }

// What the results area shows: the notice line (null hides it), its role,
// and what follows it.
interface View {
  note: string | TemplateResult | null
  role?: 'status' | 'alert'
  body?: TemplateResult
}

function fullAcct(acct: string, host: string): string {
  return acct.includes('@') || !host ? acct : `${acct}@${host}`
}

// Uses in the days the server counts (a week), from the tag's history.
function weeklyUses(tag: Tag): number | null {
  if (!tag.history || tag.history.length === 0) return null
  return tag.history.reduce((n, day) => n + (Number(day.uses) || 0), 0)
}

/**
 * The /search page body: the box, the People / Hashtags / Posts tabs and
 * the results. `q` and `type` come from the address; the element keeps the
 * address in step as the reader types (see `commit`).
 *
 * A signed-in reader searches their own server with their token, and a
 * pasted web address is resolved there. A reader who is not signed in
 * searches `instance` (the server the public timelines use) with no token:
 * Mastodon then finds accounts and hashtags, but no posts, and resolves no
 * address.
 */
@customElement('caribou-search')
export class CaribouSearch extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; }
    form { display: flex; gap: var(--space-2); padding: 0 var(--space-3) var(--space-3); }
    input {
      flex: 1; min-width: 0; font: inherit; color: var(--fg-0);
      background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3); min-height: 44px;
    }
    input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    /* A native submit: the form works with JavaScript off, which
       <caribou-button type="submit"> cannot do (README, Shared controls). */
    .submit {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 44px; min-height: 44px; font-size: 20px; color: var(--fg-1);
      background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer;
    }
    .submit:hover { color: var(--fg-0); }
    .submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .view { display: contents; }
    .notice { padding: var(--space-4) var(--space-3); color: var(--fg-muted); margin: 0; }
    .notice caribou-button { margin-inline-start: var(--space-2); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { border-bottom: 1px solid var(--border); }
    .account { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); }
    .who { display: flex; align-items: center; gap: var(--space-3); min-width: 0; flex: 1; color: inherit; text-decoration: none; }
    .who:hover .name { text-decoration: underline; }
    .avatar { width: 44px; height: 44px; flex: none; border-radius: var(--radius-md); object-fit: cover; background: var(--bg-2); }
    .names { display: flex; flex-direction: column; min-width: 0; }
    .name, .acct { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name { color: var(--fg-0); font-weight: 600; }
    .acct { color: var(--fg-muted); font-size: 0.9em; }
    caribou-button.follow { flex: none; }
    .tag { display: flex; flex-direction: column; padding: var(--space-3); color: var(--fg-0); text-decoration: none; }
    .tag:hover .tag-name { text-decoration: underline; }
    .tag-name { font-weight: 600; overflow-wrap: anywhere; }
    .tag-uses { color: var(--fg-muted); font-size: 0.9em; }
    .avatar.blurred { filter: blur(6px); }
    .covered .name { font-weight: normal; color: var(--fg-muted); white-space: normal; }
    .more-row { display: flex; flex-direction: column; align-items: center; padding: var(--space-3); }
    .more-row .notice { padding: 0 0 var(--space-2); }
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
  `]

  /** The query in the address, as the server read it. */
  @property() q = ''
  @property() type: SearchType = 'accounts'
  /** The server a reader who is not signed in searches; empty when none is known. */
  @property() instance = ''

  @state() private results: Results = { kind: 'pending' }
  // The tab and the query shown; they follow the address after mount.
  @state() private tab: SearchType | null = null
  @state() private shownQ: string | null = null
  // A Bluesky page of one kind on its way, or one that failed.
  @state() private moreLoading: MoreKind | null = null
  @state() private moreFailed: MoreKind | null = null

  @query('input') private input!: HTMLInputElement

  // Each search takes a number. Only the newest one may change the results,
  // so a slow answer to an earlier query never replaces a newer one.
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  // The current history entry holds a search the reader settled on (a
  // deep link, Enter, a tab, Back): the next typed query gets an entry of
  // its own, so Back returns to this one.
  private settled = false
  private disposers: (() => void)[] = []

  private get currentTab(): SearchType { return this.tab ?? this.type }
  private get currentQ(): string { return this.shownQ ?? this.q }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('popstate', this.onPopState)
  }

  override disconnectedCallback() {
    window.removeEventListener('popstate', this.onPopState)
    clearTimeout(this.timer)
    for (const d of this.disposers.splice(0)) d()
    // An answer still on its way belongs to no one now.
    this.seq++
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.settled = this.q.trim() !== ''
    let first = true
    // A change of account searches again, as the new reader.
    this.disposers.push(effect(() => {
      void activeClient.value
      if (first) { first = false; return }
      void this.run(this.currentQ, false)
    }))
    // The follow buttons follow the cache.
    this.disposers.push(effect(() => {
      void relationshipCache.value
      this.requestUpdate()
    }))
    // A Bluesky person row follows the reader's moderation (the veil).
    this.disposers.push(effect(() => {
      blueskyDecisionSettled(null, activeClient.value)
      this.requestUpdate()
    }))
    void this.run(this.q, true)
  }

  private async run(raw: string, resolve: boolean): Promise<void> {
    const q = raw.trim()
    const seq = ++this.seq
    const generation = ownerGeneration()
    this.moreLoading = null
    this.moreFailed = null
    if (!q) { this.results = { kind: 'empty' }; return }
    const client = activeClient.peek()
    const bluesky = rendersBluesky(client)
    const user = activeUser.peek()
    if (!client && !this.instance) { this.results = { kind: 'no-instance' }; return }
    this.results = { kind: 'loading', q }
    const current = () => seq === this.seq && generation === ownerGeneration()
    let data: Search
    let host: string
    // The reader's copies: the source is taken before the request.
    const source = client && user ? readSource(client.userKey) : undefined
    try {
      if (client && bluesky) {
        // Bluesky has no resolve: an address is searched as text.
        host = ''
        data = await client.search({ q, limit: LIMIT })
      } else if (client && user) {
        host = user.server ?? ''
        data = await client.search({ q, resolve: resolve && isUrlQuery(q), limit: LIMIT })
      } else {
        host = this.instance
        data = await searchPublic(this.instance, { q, limit: LIMIT })
      }
    } catch (err) {
      if (!current()) return
      const code = (err as { code?: string }).code
      if (bluesky && code === 'rate_limited') {
        this.results = { kind: 'error', q, message: (err as Error).message }
        return
      }
      this.results = !client && code === 'unauthorized' ? { kind: 'refused', q } : { kind: 'error', q }
      return
    }
    if (!current()) return
    try {
      // Entries the page cannot use never reach the cache or the screen.
      data = cleanSearch(data)
      // Only a signed-in search asked the server to resolve the address; a
      // signed-out answer is a text search and names nothing.
      if (client && !bluesky && resolve && this.goToResolved(q, data, host)) return
      if (client) {
        const clean = data
        const statuses = batch(() => clean.statuses.map((s) => mergeStatus(s, source)))
        data = { ...data, statuses }
        void loadRelationships(data.accounts.map((a) => a.id))
      }
    } catch {
      // A shape no check foresaw: the search ends in its error state, never
      // stuck on "Searching…".
      this.results = { kind: 'error', q }
      return
    }
    this.results = { kind: 'ok', q, data, host, signedIn: !!client, resolved: !!client && !bluesky && resolve, bluesky }
  }

  // The next Bluesky page of one kind. It adds only items not shown yet. A
  // new search, a new account or a late answer drops it.
  private async loadMore(kind: MoreKind): Promise<void> {
    const r = this.results
    const client = activeClient.peek()
    if (r.kind !== 'ok' || !r.bluesky || !client || this.moreLoading) return
    const cursor = kind === 'accounts' ? r.data.bluesky?.accountsCursor : r.data.bluesky?.statusesCursor
    if (!cursor) return
    const seq = this.seq
    const generation = ownerGeneration()
    const source = readSource(client.userKey)
    this.moreLoading = kind
    this.moreFailed = null
    let page: Search
    try {
      page = cleanSearch(await client.search({ q: r.q, type: kind, cursor, limit: LIMIT }))
    } catch {
      if (seq !== this.seq || generation !== ownerGeneration()) return
      this.moreLoading = null
      this.moreFailed = kind
      return
    }
    if (seq !== this.seq || generation !== ownerGeneration() || this.results !== r) return
    this.moreLoading = null
    const next = page.bluesky ?? { accountsCursor: null, statusesCursor: null }
    const cursors = { ...(r.data.bluesky ?? { accountsCursor: null, statusesCursor: null }) }
    let data: Search
    if (kind === 'accounts') {
      const have = new Set(r.data.accounts.map((a) => a.id))
      const added = page.accounts.filter((a) => !have.has(a.id))
      cursors.accountsCursor = next.accountsCursor
      data = { ...r.data, accounts: [...r.data.accounts, ...added], bluesky: cursors }
      void loadRelationships(added.map((a) => a.id))
    } else {
      const have = new Set(r.data.statuses.map((st) => st.id))
      const added = batch(() => page.statuses.filter((st) => !have.has(st.id)).map((st) => mergeStatus(st, source)))
      cursors.statusesCursor = next.statusesCursor
      data = { ...r.data, statuses: [...r.data.statuses, ...added], bluesky: cursors }
    }
    this.results = { ...r, data }
  }

  // What the reader's moderation says about a Bluesky person row (README,
  // "Bluesky search and hashtag page"). Fails closed: no decision covers.
  private personUi(a: Account): PersonUi {
    if (!a.bluesky) return { hide: false, cover: null, blurAvatar: false }
    const mod = a.bluesky.moderation ?? null
    const client = activeClient.peek()
    if (mod && !blueskyDecisionSettled({ viewerOf: currentBlueskyReader(client), moderation: mod }, client)) {
      return { hide: false, cover: CHECKING_PERSON, blurAvatar: true }
    }
    const list = mod ? uiOf(mod, 'profileList')! : UNREADABLE
    const avatar = mod ? uiOf(mod, 'avatar')! : UNREADABLE
    return { hide: list.filter, cover: list.blur ? `Someone (${coverNote(list)})` : null, blurAvatar: avatar.blur }
  }

  // A pasted address that names one post or one account opens it. The
  // search entry is replaced, so Back does not land on a search that would
  // open the same page again.
  private goToResolved(q: string, data: Search, host: string): boolean {
    const path = resolvedPath(q, data, host)
    // Only the page at the address moves: a full load mounts this page
    // twice, and the second copy must not navigate again.
    if (!path || location.pathname !== '/search' || parseSearch(location.search).q.trim() !== q) return false
    history.replaceState(null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
    return true
  }

  // Puts the query in the address and searches. A typed query replaces the
  // entry it started from, unless that entry holds a settled search.
  private commit(opts: { push: boolean; resolve: boolean }) {
    clearTimeout(this.timer)
    // The reader has left: a link click already changed the address, and
    // the page is only waiting for the router to swap it out.
    if (location.pathname !== '/search') return
    const q = this.input.value
    const path = searchPath(q.trim(), this.currentTab)
    const here = location.pathname + location.search
    if (path !== here) {
      if (opts.push || this.settled) history.pushState(null, '', path)
      else history.replaceState(null, '', path)
    }
    this.settled = opts.push
    this.shownQ = q
    void this.run(q, opts.resolve)
  }

  private onInput = (e: InputEvent) => {
    clearTimeout(this.timer)
    // A pasted address resolves at once.
    if (e.inputType === 'insertFromPaste' && isUrlQuery(this.input.value)) {
      this.commit({ push: true, resolve: true })
      return
    }
    this.timer = setTimeout(() => this.commit({ push: false, resolve: false }), DEBOUNCE_MS)
  }

  private onSubmit = (e: Event) => {
    e.preventDefault()
    this.commit({ push: true, resolve: true })
  }

  private onTab = (e: MouseEvent, type: SearchType) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (type === this.currentTab) return
    // The tab takes the typed query now; the waiting search would repeat it.
    clearTimeout(this.timer)
    const q = (this.input?.value ?? this.currentQ).trim()
    history.pushState(null, '', searchPath(q, type))
    this.settled = true
    this.tab = type
    // The results hold all three kinds; a changed query searches again.
    if (this.results.kind !== 'ok' || this.results.q !== q) {
      this.shownQ = q
      void this.run(q, false)
    }
  }

  // Back and Forward between searches. The router may also build a new
  // page for the entry; this one keeps up in case it does not.
  private onPopState = () => {
    clearTimeout(this.timer)
    if (location.pathname !== '/search') return
    const { q, type } = parseSearch(location.search)
    this.tab = type
    this.settled = true
    if (this.input) this.input.value = q
    const shown = this.results.kind === 'ok' || this.results.kind === 'loading' ? this.results.q : null
    this.shownQ = q
    if (shown !== q.trim()) void this.run(q, false)
  }

  private retry = () => { void this.run(this.currentQ, false) }

  override render() {
    const q = this.currentQ
    const tab = this.currentTab
    return html`
      <form role="search" action="/search" method="get" @submit=${this.onSubmit}>
        <label class="vh" for="search-q">Search</label>
        <input id="search-q" type="search" name="q" value=${q} autocomplete="off" enterkeyhint="search"
          placeholder="Search people, hashtags, posts" @input=${this.onInput} />
        ${tab === 'accounts' ? nothing : html`<input type="hidden" name="type" value=${tab} />`}
        <button class="submit" type="submit" aria-label="Search"><caribou-icon name="search"></caribou-icon></button>
      </form>
      <caribou-tabs class="tabs" label="Result type" fill>
        ${SEARCH_TABS.map((t) => html`<a href=${searchPath(q.trim(), t.type)}
          aria-current=${t.type === tab ? 'page' : nothing}
          @click=${(e: MouseEvent) => this.onTab(e, t.type)}>${t.label}</a>`)}
      </caribou-tabs>
      <div class="results">${this.renderResults(tab)}</div>
    `
  }

  private renderResults(tab: SearchType) {
    const v = this.view(tab)
    // One notice line for every state. The server sends it, and it stays the
    // same element whatever the state turns into after mount, so hydration
    // keeps the server's node and nothing it sent is removed.
    return html`<div class="view"><p class="notice" role=${v.role ?? nothing} ?hidden=${v.note === null}>${v.note ?? ''}</p>${v.body ?? nothing}</div>`
  }

  private view(tab: SearchType): View {
    const r = this.results
    switch (r.kind) {
      case 'empty':
        return { note: HINT }
      case 'pending':
        return this.q.trim() ? { note: 'Searching…', role: 'status' } : { note: HINT }
      case 'loading':
        return { note: 'Searching…', role: 'status' }
      case 'no-instance':
        return { note: null, body: html`<caribou-auth-required
          label="Search needs to know which server to ask. Sign in once and Caribou will remember."></caribou-auth-required>` }
      case 'refused':
        return { note: null, body: html`<caribou-auth-required
          label="This server searches only for signed-in readers."></caribou-auth-required>` }
      case 'error':
        return { note: r.message
          ? html`<span>${r.message}</span><caribou-button @click=${this.retry}>Retry</caribou-button>`
          : html`Search failed.<caribou-button @click=${this.retry}>Retry</caribou-button>`, role: 'alert' }
      case 'ok':
        return this.viewOk(r, tab)
    }
  }

  private viewOk(r: Extract<Results, { kind: 'ok' }>, tab: SearchType): View {
    if (r.bluesky) return this.viewBluesky(r, tab)
    // An address the server did not open. Signed out, it cannot look one up.
    const url = isUrlQuery(r.q)
    const urlNote = !url ? null
      : !r.signedIn ? 'Sign in to open a post or profile from another server.'
      : r.resolved ? 'Nothing found at that address.' : 'Press Enter to look up this address.'
    const empty = (what: string): View => ({
      note: urlNote, role: 'status',
      body: html`<p class="notice" role="status">No ${what} found for “${r.q}”.</p>`,
    })
    // Signed out, the note stays over the results: none of them is the
    // address itself.
    const listNote = url && !r.signedIn ? urlNote : null
    if (tab === 'accounts') {
      if (r.data.accounts.length === 0) return empty('people')
      return { note: listNote, role: 'status',
        body: html`<ul class="accounts">${repeat(r.data.accounts, (a) => a.id, (a) => this.renderAccount(a, r))}</ul>` }
    }
    if (tab === 'hashtags') {
      if (r.data.hashtags.length === 0) return empty('hashtags')
      return { note: listNote, role: 'status', body: html`<ul class="hashtags">${repeat(r.data.hashtags, (t) => t.name, (t) => {
        const uses = weeklyUses(t)
        return html`<li><a class="tag" href=${tagPath(t.name)} @click=${spaClick}>
          <span class="tag-name">#${t.name}</span>
          ${uses === null ? nothing : html`<span class="tag-uses">${uses} ${uses === 1 ? 'post' : 'posts'} this week</span>`}
        </a></li>`
      })}</ul>` }
    }
    if (!r.signedIn) {
      return { note: 'Sign in to search posts. Mastodon finds posts only for a signed-in reader.', role: 'status' }
    }
    if (r.data.statuses.length === 0) return empty('posts')
    return { note: null, body: html`<ul class="statuses">${repeat(r.data.statuses, (s) => s.id, (s) => html`<li>
      <caribou-status-card .status=${s} instance=${r.host}></caribou-status-card>
    </li>`)}</ul>` }
  }

  private viewBluesky(r: Extract<Results, { kind: 'ok' }>, tab: SearchType): View {
    const empty = (what: string): View => ({
      note: null, body: html`<p class="notice" role="status">No ${what} found for “${r.q}”.</p>`,
    })
    if (tab === 'hashtags') {
      const name = parseTagParam(encodeURIComponent(r.q))
      if (name === null) return { note: NO_BLUESKY_TAGS, role: 'status' }
      return { note: null, body: html`<ul class="hashtags"><li><a class="tag" href=${`${tagPath(name)}?net=bsky`} @click=${spaClick}>
        <span class="tag-name">#${name}</span></a></li></ul>` }
    }
    if (tab === 'accounts') {
      const shown = r.data.accounts.map((a) => ({ a, ui: this.personUi(a) })).filter((x) => !x.ui.hide)
      if (shown.length === 0 && !r.data.bluesky?.accountsCursor) return empty('people')
      return { note: null, body: html`<div class="page"><ul class="accounts">${repeat(shown, (x) => x.a.id, (x) => this.renderPerson(x.a, x.ui))}</ul>
        ${this.renderMore('accounts', r.data.bluesky?.accountsCursor ?? null)}</div>` }
    }
    if (r.data.statuses.length === 0 && !r.data.bluesky?.statusesCursor) return empty('posts')
    return { note: null, body: html`<div class="page"><ul class="statuses">${repeat(r.data.statuses, (s) => s.id, (s) => html`<li>
      <caribou-status-card .status=${s}></caribou-status-card>
    </li>`)}</ul>${this.renderMore('statuses', r.data.bluesky?.statusesCursor ?? null)}</div>` }
  }

  private renderMore(kind: MoreKind, cursor: string | null) {
    if (!cursor) return nothing
    const label = kind === 'accounts' ? 'More people' : 'More posts'
    const failed = this.moreFailed === kind
    return html`<div class="more-row">
      ${failed ? html`<p class="notice" role="alert">Could not load more.</p>` : nothing}
      <caribou-button class="more" variant="secondary" ?loading=${this.moreLoading === kind}
        @click=${() => void this.loadMore(kind)}>${failed ? 'Retry' : label}</caribou-button>
    </div>`
  }

  // A Bluesky person: `/@<handle>` (or the DID), the handle with no host.
  private renderPerson(a: Account, ui: PersonUi) {
    const face = html`<img class=${ui.blurAvatar || ui.cover !== null ? 'avatar blurred' : 'avatar'} src=${a.avatarStatic || a.avatar}
      alt="" width="44" height="44" loading="lazy" decoding="async" />`
    if (ui.cover !== null) {
      return html`<li class="account covered" data-account-id=${a.id}><span class="who">${face}
        <span class="names"><span class="name">${ui.cover}</span></span></span></li>`
    }
    return html`<li class="account" data-account-id=${a.id}>
      <a class="who" href=${accountPath(a, '')} @click=${spaClick}>
        ${face}
        <span class="names">
          <span class="name">${a.displayName || a.username}</span>
          <span class="acct">@${a.acct}</span>
        </span>
      </a>
      ${this.renderFollow(a, a.acct)}
    </li>`
  }

  private renderAccount(a: Account, r: Extract<Results, { kind: 'ok' }>) {
    const acct = fullAcct(a.acct, r.host)
    return html`<li class="account" data-account-id=${a.id}>
      <a class="who" href=${profilePath(a.acct, r.host, a.url)} @click=${spaClick}>
        <img class="avatar" src=${a.avatarStatic || a.avatar} alt="" width="44" height="44" loading="lazy" decoding="async" />
        <span class="names">
          <span class="name">${a.displayName || a.username}</span>
          <span class="acct">@${acct}</span>
        </span>
      </a>
      ${r.signedIn ? this.renderFollow(a, acct) : nothing}
    </li>`
  }

  // The account ids are the reader's server's, so the button acts on them
  // directly. Shown once the relationship is known.
  private renderFollow(a: Account, acct: string) {
    const user = activeUser.peek()
    if (!user) return nothing
    const own = a.bluesky ? a.bluesky.did === didOfUserKey(user.userKey) : isOwnAccount(user, a)
    if (own) return nothing
    const rel = relationshipFor(a.id)
    // Unknown fields (state README, A1): no button until the read fills them.
    if (!relationshipKnown(rel) || rel.blocking) return nothing
    const label = rel.following ? 'Following' : rel.requested ? 'Requested' : 'Follow'
    return html`<caribou-button class="follow" data-state=${label.toLowerCase()}
      variant=${label === 'Follow' ? 'primary' : 'secondary'}
      @click=${() => void toggleFollow(a)}>${label}<span class="vh"> @${acct}</span></caribou-button>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-search': CaribouSearch }
}
