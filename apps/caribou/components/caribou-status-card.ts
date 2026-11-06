import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import type { Status, StatusSource } from '@beatzball/caribou-mastodon-client'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import { formatRelativeTime } from '@beatzball/caribou-ui-headless'
import { effect } from '@preact/signals-core'
import {
  activeClient, activeUser, activeUserKey, createKeepAlive, deleteOwnStatus, deletedStatusIds, EDIT_FIELDS,
  isOwnAccount, mergeStatus, olderEdit, ownerGeneration, loadReaderView, readerCheckFor, readerFiltered, readerQuote, relationshipCache, relationshipKey, setBlock, setMute,
  type ReaderCheck, statusCache, toggleBookmark, toggleFavourite, toggleReblog,
} from '@beatzball/caribou-state'
import { profilePath } from './_profile-path.js'
import { findShell } from './_shell.js'
import { filterVerdict, type FilterContext, type FilterVerdict } from './_status-filter.js'
import { confirmBlock, confirmDialog } from './caribou-confirm-dialog.js'
import { POLL_EDIT_REFUSED, redraftOf } from './_redraft.js'
import { showStatusHistory } from './caribou-status-history.js'
import { spaClick } from './_spa-link.js'
import { tagPath } from './_tag-path.js'
import { hashtagOf, sameUrl } from './_post-links.js'
import { mastodonLinkText } from './_shared-styles.js'
import './caribou-icon.js'
import './caribou-icon-button.js'
import './caribou-button.js'
import './caribou-menu.js'
import './caribou-status-media.js'
import './caribou-status-link-card.js'
import './caribou-status-quote.js'
import './caribou-status-poll.js'

// The same hooks as the server's sanitizer, so the two agree on every string.
// Without a window DOMPurify is a stub with no `addHook`; the server has its
// own instance.
if (typeof window !== 'undefined') installPurifyHooks(DOMPurify)

export type StatusCardVariant = 'timeline' | 'focused' | 'ancestor' | 'descendant'

function absoluteLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Permalink for the timestamp anchor.
//
// The id we encode is the home instance's local id for the status (i.e.
// `status.id` as masto.js returns it from the home timeline). The route
// resolver for `/@:handle/:statusId` queries the home instance — never
// the path host — because status ids are minted per-instance and the home
// instance is the only one guaranteed to recognize this id. The handle in
// the path is for display + share-context, not routing.
//
// This matches Elk's `/{home-instance}/@{user}@{host}/{home-id}` model;
// Caribou drops the leading `/{home-instance}/` segment because we tie
// the home instance to the `caribou.instance` cookie instead of the URL.
//
// Edge case: a status whose id contains characters that are unsafe in a
// URL path (some non-Mastodon ActivityPub bridges expose ids with `/`,
// `:`, etc.). Encode via `encodeURIComponent` so the URL stays
// well-formed; the route resolver decodes it back.

// The fields the action bar shows. The card re-reads them from the status
// cache after mount, so an action taken anywhere shows here even when the
// parent's `.status` is a copy the cache does not own (the thread store).
interface ActionFields {
  favourited: boolean
  favouritesCount: number
  reblogged: boolean
  reblogsCount: number
  bookmarked: boolean
  repliesCount: number
}

function actionFields(s: Status): ActionFields {
  return {
    favourited: s.favourited === true,
    favouritesCount: s.favouritesCount ?? 0,
    reblogged: s.reblogged === true,
    reblogsCount: s.reblogsCount ?? 0,
    bookmarked: s.bookmarked === true,
    repliesCount: s.repliesCount ?? 0,
  }
}

function sameFields(a: ActionFields, b: ActionFields): boolean {
  return a.favourited === b.favourited && a.favouritesCount === b.favouritesCount
    && a.reblogged === b.reblogged && a.reblogsCount === b.reblogsCount
    && a.bookmarked === b.bookmarked && a.repliesCount === b.repliesCount
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}

// Posts whose content warning the reader opened. Module scope, so a card the
// page cache paints again stays open. Only a click adds to it, so the server
// render and the first client render are both collapsed.
//
// A status id is minted per instance, so the key is the instance the status
// came from plus its id: another instance's post with the same id stays
// collapsed. A keep-alive empties itself when the active account changes.
const openedWarnings = createKeepAlive<boolean>(500)
// Posts hidden by a filter's warning that the reader showed. Same rules.
const shownFiltered = createKeepAlive<boolean>(500)

function sameVerdict(a: FilterVerdict | null | undefined, b: FilterVerdict | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.action === b.action && a.titles.join('\n') === b.titles.join('\n')
}

// A copy with the newest `filtered` the reader's server sent for it,
// whichever copy that came in (`readerFiltered`). Without one, the copy's own.
function withNewestFilters(post: Status): Status {
  const f = readerFiltered(post.id)
  return f ? { ...post, filtered: f as Status['filtered'] } : post
}

// The session an action started under. A step that runs after an await (a
// dialog's answer, Undo) checks it is still the one signed in: account ids
// are minted per server, and the same id on the next account's server is
// someone else.
interface Owner {
  client: NonNullable<typeof activeClient.value>
  userKey: string
  generation: number
}

function currentOwner(): Owner | null {
  const client = activeClient.peek()
  const userKey = activeUserKey.peek()
  return client && userKey ? { client, userKey, generation: ownerGeneration() } : null
}

function stillOwner(o: Owner): boolean {
  return activeUserKey.peek() === o.userKey && ownerGeneration() === o.generation
}

// A card whose list keeps its own copy of the post (a thread,
// notifications) takes the fields an edit changes (`EDIT_FIELDS`) from the
// cached copy once that is newer, so an edit shows everywhere at once.
function newerEdit(cached: Status | undefined, shown: Status): Status | null {
  return cached && olderEdit(shown, cached) ? cached : null
}

function withEdit(post: Status, edit: Status | null): Status {
  if (!edit || edit.id !== post.id) return post
  const out = { ...post } as Record<string, unknown>
  for (const key of EDIT_FIELDS) out[key] = (edit as unknown as Record<string, unknown>)[key]
  return out as unknown as Status
}

function toast(kind: 'error' | 'info', message: string): void {
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind, message } }))
}

type Moderated = { verb: 'muted' | 'blocked'; account: Status['account']; owner: Owner }

export function statusPermalink(s: { id: string; account: { acct: string } }): string {
  return `/@${s.account.acct}/${encodeURIComponent(s.id)}`
}

@customElement('caribou-status-card')
export class CaribouStatusCard extends LitElement {
  static override styles = [mastodonLinkText, css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    /* Hidden from a signed-in reader until their filters for the post are
       known; see server/lib/reader-veil-head.ts. */
    article { visibility: var(--caribou-reader-veil, visible); }
    article:focus { outline: none; }
    article:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    article { padding: var(--space-4); border-bottom: 1px solid var(--border); }
    /* The avatar sits in the gutter beside the body, but it is part of the
       author link in the header, so one link holds avatar, name and acct.
       The link's own box is the name line, which is what a link-hint tool
       labels; the focus ring goes around it and the avatar. */
    .row {
      position: relative; min-height: 48px;
      padding-inline-start: calc(48px + var(--space-3));
    }
    .author img {
      position: absolute; inset-inline-start: 0; top: 0;
      border-radius: var(--radius-md);
    }
    .body { min-width: 0; }
    header { display: flex; gap: var(--space-2); align-items: baseline; flex-wrap: wrap; }
    .author {
      display: inline-flex; gap: var(--space-2); align-items: baseline; flex-wrap: wrap;
      min-width: 0; color: inherit; text-decoration: none; border-radius: var(--radius-sm);
    }
    .author:hover strong { text-decoration: underline; }
    .author:focus-visible,
    .author:focus-visible img { outline: 2px solid var(--accent); outline-offset: 2px; }
    .author strong { color: var(--fg-0); }
    .acct { color: var(--fg-muted); overflow-wrap: anywhere; }
    .status-content { color: var(--fg-0); margin-top: var(--space-2); }
    .status-content,
    .status-content > p,
    .status-content a {
      overflow-wrap: anywhere;
      word-break: break-word;
      min-width: 0;
    }
    /* Mastodon emits author-typed "#AI#Tech" as <a>#AI</a><a>#Tech</a> with no
       whitespace between them. Push the second link a quarter em to its
       inline-start side; the gap sits outside the link's content area, so the
       underline ends cleanly with each link instead of bridging an injected
       space. */
    .status-content a + a {
      margin-inline-start: 0.25em;
    }
    /* Focused post emphasis: bigger body type only. The accent border was
       visually load-bearing in the wrong direction — readers mistook the
       blue 1px outline for an "older posts" affordance. Ancestor opacity
       and descendant indentation already differentiate the focused row. */
    article[data-variant="focused"] .status-content { font-size: 1.1rem; }
    article[data-variant="ancestor"] { opacity: 0.75; }
    article[data-variant="descendant"] { margin-inline-start: var(--space-4); }
    time { color: var(--fg-muted); font-size: 0.875rem; }
    .permalink {
      color: inherit; text-decoration: none;
    }
    .permalink:hover time { text-decoration: underline; }
    .actions {
      display: flex; gap: var(--space-4); margin-top: var(--space-3);
      margin-inline-start: calc(-1 * var(--space-2));
    }
    .actions caribou-icon-button { font-size: 0.875rem; }
    /* Repeat is all lines: a pressed boost changes colour, not fill. */
    .actions .boost {
      --caribou-icon-button-pressed-fg: var(--success);
      --caribou-icon-fill: none;
    }
    .warning { margin-top: var(--space-2); }
    /* Mastodon's "RE: <link>" fallback for older apps; the quote shows it. */
    .status-body:has(caribou-status-quote) .quote-inline { display: none; }
    .spoiler {
      margin: 0; color: var(--fg-0); white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .cw-toggle, .notice button {
      margin-top: var(--space-2); padding: var(--space-1) var(--space-3);
      font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer;
      color: var(--fg-0); background: var(--bg-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
    }
    .notice button { margin-top: 0; }
    .cw-toggle:hover, .notice button:hover { background: var(--bg-1); }
    .cw-toggle:focus-visible, .notice button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .edited {
      color: var(--fg-muted); font: inherit; font-size: 0.875rem;
      background: none; border: 0; padding: 0;
    }
    /* A word in the meta line, not a boxed button. The control keeps its
       44px height on a coarse pointer. */
    caribou-button.edited { --caribou-button-size: 0; }
    caribou-button.edited::part(button) {
      padding: 0; border: 0; border-radius: var(--radius-sm);
      color: inherit; background: none;
      text-decoration: underline dotted;
    }
    caribou-button.edited:hover::part(button) { color: var(--fg-1); background: none; }
    caribou-button.edited::part(button):focus-visible { outline-offset: 2px; }
    @media (pointer: coarse) {
      caribou-button.edited { --caribou-button-size: 44px; }
      caribou-button.edited::part(button) { padding-inline: var(--space-2); }
    }
    .actions caribou-menu.more { margin-inline-start: auto; }
    .actions caribou-menu.more::part(trigger) { color: var(--fg-muted); }
    @media (pointer: fine) {
      .actions caribou-menu.more::part(trigger) { min-inline-size: 2.25rem; min-block-size: 2.25rem; }
    }
    .menu-item {
      display: block; inline-size: 100%; padding: var(--space-2) var(--space-3);
      font: inherit; text-align: start; color: var(--fg-1); background: none;
      border: 0; border-radius: var(--radius-sm); cursor: pointer;
    }
    .menu-item:hover { background: var(--bg-1); }
    .menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .menu-item.danger { color: var(--danger); }
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
    .notice {
      display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap;
      color: var(--fg-muted);
    }
    .notice p { margin: 0; flex: 1; overflow-wrap: anywhere; }
    .notice strong { color: var(--fg-0); }
    .filtered-post:not([hidden]) { margin-top: var(--space-3); }
    .boost-attribution {
      display: flex; gap: var(--space-2); align-items: center;
      padding: 0 0 var(--space-2) var(--space-2);
      color: var(--fg-muted); font-size: 0.875rem;
    }
    .boost-attribution a { color: inherit; text-decoration: none; }
    .boost-attribution a:hover { text-decoration: underline; }
    .boost-attribution a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  `]

  @property({ attribute: false }) status: Status | null = null
  @property({ reflect: true }) variant: StatusCardVariant = 'timeline'
  // The instance the status came from. Optional: without it the card reads
  // the instance off the enclosing `<caribou-app-shell>` after mount.
  @property() instance = ''
  // Where the card is shown, for the reader's server filters: home,
  // notifications, public, thread or account. Empty never filters
  // (bookmarks). In every context but account, a post by an account the
  // reader mutes or blocks is hidden too.
  @property({ attribute: 'filter-context' }) filterContext: FilterContext | '' = ''

  // Both start false, so the server and the first client render show the
  // signed-out bar. `bindActions` sets them after mount.
  @state() private canAct = false
  @state() private ownPost = false
  // The post is the active account's own, by account id (never by handle):
  // its menu offers Edit and Delete instead of Mute and Block.
  @state() private mine = false
  // A newer edit of the post than `status` carries, from the cache.
  @state() private liveEdit: Status | null = null
  // The reader deleted this post (or the post this boosts).
  @state() private deleted = false
  // The quote the post's record says (`readerQuote`), for a reader on the
  // same server: the reader's copy says whether they may see the quoted
  // post (muted, blocked, revoked …), whichever copy brought it, and a list
  // that keeps its own copy (a thread) never gets it. Undefined until
  // mount, and while no copy of the post said.
  @state() private liveQuote: Status['quote'] | undefined = undefined
  @state() private liveFields: ActionFields | null = null
  // The filter verdict from the newest copy; undefined until mount, when
  // render() reads `status` itself, as the server did.
  @state() private liveVerdict: FilterVerdict | null | undefined = undefined
  // The reader showed this post past its filter warning.
  @state() private filterShown = false
  // The reader's relationship with the author, for the menu's labels.
  @state() private authorRel: { muting: boolean; blocking: boolean } = { muting: false, blocking: false }
  // The author or the booster is muted or blocked, in a context that hides it.
  @state() private relHidden = false
  // Who is muted or blocked, for the note on a thread's main post, which is
  // never removed.
  @state() private relWhy: { verb: 'muted' | 'blocked'; acct: string } | null = null
  // The reader muted or blocked the author from this card's menu. The card
  // then shows that, with Undo, where the post was, so focus has a place.
  @state() private moderated: Moderated | null = null
  // Where the reader's-filters check for this post stands (`loadReaderView`):
  // pending, failed, or undefined when settled or not asked.
  @state() private readerCheck: ReaderCheck | undefined = undefined
  // The reader chose Show on a post not checked yet. Kept apart from
  // `filterShown`: a warning that arrives later must still warn.
  @state() private uncheckedShown = false
  // A Retry of a failed check is out.
  @state() private retrying = false
  // Set by render(): the cover shown is the unchecked one.
  private coverIsUnchecked = false
  // Set by render(), read by updated(): the post itself is on screen.
  private renderedPost = false
  // Set by render(), read by updated(): the host is hidden.
  private hiddenNow = false

  private disposeActions: (() => void) | null = null
  private shellObserver: MutationObserver | null = null

  // The server prints an absolute timestamp so its HTML does not depend on
  // the clock. The first client render repeats it; after that the card
  // switches to the relative form.
  @state() private relativeTime = false

  // The shell's instance, read after mount. The server cannot walk up to the
  // shell, so the first render takes the host from the account URL like the
  // server did, and the next render uses this.
  @state() private shellInstance = ''

  // The reader opened this post's content warning.
  @state() private warningOpen = false

  // True when the shadow root came from the server (declarative shadow DOM)
  // and the first render hydrates it instead of creating it.
  private adoptedServerRender = false

  private retryUrl = ''
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined

  protected override createRenderRoot() {
    this.adoptedServerRender = this.shadowRoot !== null
    return super.createRenderRoot()
  }

  protected override firstUpdated() {
    this.relativeTime = true
    this.bindActions()
  }

  override connectedCallback() {
    super.connectedCallback()
    // Re-attach after a move in the DOM; the first bind is in firstUpdated.
    if (this.hasUpdated && !this.disposeActions) this.bindActions()
  }

  override disconnectedCallback() {
    clearTimeout(this.retryTimer)
    this.unbindActions()
    super.disconnectedCallback()
  }

  private unbindActions() {
    this.disposeActions?.()
    this.disposeActions = null
    this.shellObserver?.disconnect()
    this.shellObserver = null
  }

  private bindActions() {
    this.shellInstance = findShell(this)?.getAttribute('instance') ?? ''
    // The shell's `instance` is an attribute, not a signal; watch it so a
    // change re-decides whether this card can act.
    if (!this.instance) {
      const shell = findShell(this)
      if (shell) {
        this.shellObserver = new MutationObserver(() => this.rebindActions())
        this.shellObserver.observe(shell, { attributes: true, attributeFilter: ['instance'] })
      }
    }
    this.disposeActions = effect(() => {
      const client = activeClient.value
      const user = activeUser.value
      const s = this.status
      const post = s?.reblog ?? s
      this.canAct = client !== null && this.sameInstance(user?.server)
      this.ownPost = this.canAct && post !== null && post !== undefined && user !== null && isOwnAccount(user, post.account)
      const mine = this.canAct && !!post && !!user?.account && user.account.id === post.account.id
      if (mine !== this.mine) this.mine = mine
      const cache = statusCache.value
      const cached = post ? cache.get(post.id) ?? (s?.reblog ? cache.get(s.id)?.reblog : undefined) : undefined
      const next = cached ? actionFields(cached) : null
      const prev = this.liveFields
      if (next === null ? prev !== null : prev === null || !sameFields(prev, next)) this.liveFields = next
      const edit = post && this.canAct ? newerEdit(cached ?? undefined, post) : null
      if (edit !== this.liveEdit) this.liveEdit = edit
      const quote = this.canAct && post ? readerQuote(post.id) : undefined
      if (quote !== this.liveQuote) this.liveQuote = quote
      const gone = deletedStatusIds.value
      const deleted = this.canAct && !!s && (gone.has(s.id) || (!!post && gone.has(post.id)))
      if (deleted !== this.deleted) this.deleted = deleted

      // The reader's own posts are never filtered.
      // The boost and the post it boosts each by their newest `filtered`,
      // whichever copy brought it: the post alone or inside a boost.
      const source = s
        ? s.reblog ? { ...withNewestFilters(s), reblog: withNewestFilters(s.reblog) } : withNewestFilters(s)
        : null
      const verdict = source && !this.ownPost ? filterVerdict(source, this.filterContext || null) : null
      if (!sameVerdict(verdict, this.liveVerdict)) this.liveVerdict = verdict

      // Relationship ids are the reader's server's, so only a card that can
      // act (same instance) may look them up.
      const rels = relationshipCache.value
      const relOf = (id: string) => this.canAct && user ? rels.get(relationshipKey(user.userKey, id)) : undefined
      const author = post ? relOf(post.account.id) : undefined
      const booster = s?.reblog ? relOf(s.account.id) : undefined
      const muting = author?.muting === true
      const blocking = author?.blocking === true
      if (muting !== this.authorRel.muting || blocking !== this.authorRel.blocking) {
        this.authorRel = { muting, blocking }
      }
      type Verb = 'muted' | 'blocked'
      const boosterMuted: Verb | null = booster?.blocking === true ? 'blocked' : booster?.muting === true ? 'muted' : null
      const authorMuted: Verb | null = blocking ? 'blocked' : muting ? 'muted' : null
      const why = authorMuted ? { verb: authorMuted, acct: post!.account.acct }
        : boosterMuted ? { verb: boosterMuted, acct: s!.account.acct } : null
      if (why?.verb !== this.relWhy?.verb || why?.acct !== this.relWhy?.acct) this.relWhy = why
      const hides = this.filterContext !== '' && this.filterContext !== 'account'
      const relHidden = hides && [author, booster].some((r) => r?.muting === true || r?.blocking === true)
      if (relHidden !== this.relHidden) this.relHidden = relHidden
      const check = s && this.canAct && user ? readerCheckFor(user.userKey, s.id) : undefined
      if (check !== this.readerCheck) this.readerCheck = check
      // "You muted …" belongs to the account that did it.
      if (this.moderated && !stillOwner(this.moderated.owner)) this.moderated = null
    })
  }

  // Hosts are case-insensitive; `server` is a bare host, like `instance`.
  // No known instance means the page did not say, as in caribou-profile.
  private sameInstance(server: string | undefined): boolean {
    const instance = this.instance || (findShell(this)?.getAttribute('instance') ?? '')
    if (!instance) return true
    return server !== undefined && server.toLowerCase() === instance.toLowerCase()
  }

  private rebindActions() {
    this.unbindActions()
    this.bindActions()
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    // The effect only re-runs on a signal change. A new `.status` must not
    // show the old post's cached fields for a render, and a new `instance`
    // decides again whether the buttons act.
    if ((changed.has('status') || changed.has('instance') || changed.has('filterContext')) && this.disposeActions) {
      this.rebindActions()
    }
    // The server and a hydrating render are collapsed; the server has no
    // DOM to find the shell in, and keep-alives are client only.
    if (changed.has('status')) {
      const hydrating = this.adoptedServerRender && !this.hasUpdated
      const key = typeof window === 'undefined' || hydrating ? null : this.warningKey()
      this.warningOpen = key !== null && openedWarnings.get(key) === true
      this.filterShown = key !== null && shownFiltered.get(key) === true
      this.uncheckedShown = false
      this.moderated = null
    }
  }

  protected override updated() {
    this.toggleAttribute('hidden', this.hiddenNow)
    // The head script hides every card's post from a signed-in reader until
    // the card says (`server/lib/reader-veil-head.ts`). The card lifts that
    // unless what it rendered is a post still waiting for its check: the
    // render that hydrates the server's markup, before the card has drawn
    // its cover.
    const veiled = this.renderedPost && this.unchecked()
    this.style.setProperty('--caribou-reader-veil', veiled ? 'hidden' : 'visible')
  }

  // The instance the shown post came from, the same order `profileHref`
  // uses, then its id. The status cache is home-instance only, so the shell
  // is read here directly: on the first render `shellInstance` is not set.
  private warningKey(): string | null {
    const post = this.status?.reblog ?? this.status
    if (!post) return null
    const instance = this.instance || (findShell(this)?.getAttribute('instance') ?? '') || hostOf(post.account.url ?? '')
    return `${instance.toLowerCase()} ${post.id}`
  }

  // The button stays where it is and only its text changes, so focus stays
  // on it.
  private onToggleWarning = () => {
    const key = this.warningKey()
    this.warningOpen = !this.warningOpen
    if (key !== null) openedWarnings.set(key, this.warningOpen)
  }

  private onToggleFiltered = () => {
    if (this.coverIsUnchecked) {
      this.uncheckedShown = !this.uncheckedShown
      return
    }
    const key = this.warningKey()
    this.filterShown = !this.filterShown
    if (key !== null) shownFiltered.set(key, this.filterShown)
  }

  // One rule for a post the server rendered without the reader's token: it
  // stays covered until the reader's check for it has settled, or the
  // reader asks to see it. That holds while the check is out, after it
  // failed, for a post the server left out, and during a Retry.
  private unchecked(): boolean {
    return (this.readerCheck === 'pending' || this.readerCheck === 'failed') && !this.uncheckedShown
  }

  // Asks again for the reader's copy of a post whose check failed. The note
  // stays, with a busy Retry, so focus stays on it; when the check settles
  // the post shows and focus goes to it.
  private onRetryCheck = async () => {
    const s = this.status
    const owner = currentOwner()
    if (!s || !owner || this.retrying) return
    this.retrying = true
    try {
      await loadReaderView([s], owner.client)
    } finally {
      this.retrying = false
    }
    if (this.readerCheck !== undefined) return
    await this.updateComplete
    const article = this.renderRoot.querySelector('article')
    article?.setAttribute('tabindex', '-1')
    article?.focus()
  }

  private async focusIn(selector: string) {
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>(selector)?.focus()
  }

  // Shows "You muted …" with Undo in the post's place at once, then asks
  // the server. A failure brings the post back (the state layer says why).
  private async moderate(verb: Moderated['verb'], owner: Owner, write: () => Promise<boolean>) {
    const post = this.status?.reblog ?? this.status
    if (!post) return
    const mine: Moderated = { verb, account: post.account, owner }
    this.moderated = mine
    void this.focusIn('caribou-button.undo')
    // Another account is signed in now: the notice is gone, and focus is
    // the new page's.
    if (await write() || this.moderated !== mine || !stillOwner(owner)) return
    this.moderated = null
    void this.focusIn('caribou-menu.more')
  }

  private onMute = () => {
    const account = (this.status?.reblog ?? this.status)?.account
    const owner = currentOwner()
    if (!this.canAct || !account || !owner) return
    const opts = { clientSource: () => owner.client }
    if (this.authorRel.muting) void setMute(account, false, opts)
    else void this.moderate('muted', owner, () => setMute(account, true, opts))
  }

  private onBlock = async () => {
    const account = (this.status?.reblog ?? this.status)?.account
    const owner = currentOwner()
    if (!this.canAct || !account || !owner) return
    const opts = { clientSource: () => owner.client }
    if (this.authorRel.blocking) {
      void setBlock(account, false, opts)
      return
    }
    const ok = await confirmBlock(account.acct)
    // The account changed while the question was open: this id is not the
    // new account's to block.
    if (ok && stillOwner(owner)) void this.moderate('blocked', owner, () => setBlock(account, true, opts))
  }

  // Undo runs after the mute or block in the queue, even while that is
  // still on its way, so the account ends as the reader chose.
  private onUndoModerate = () => {
    const m = this.moderated
    if (!m) return
    this.moderated = null
    if (stillOwner(m.owner)) {
      const opts = { clientSource: () => m.owner.client }
      void (m.verb === 'muted' ? setMute(m.account, false, opts) : setBlock(m.account, false, opts))
    }
    void this.focusIn('caribou-menu.more')
  }

  // The post as shown: with a newer edit from the cache over `status`.
  private shownPost(): Status | null {
    const post = this.status?.reblog ?? this.status
    return post ? withEdit(post, this.liveEdit) : null
  }

  // Edit opens the compose dialog with the post's source text (as the
  // author typed it, not the server's HTML) and the post as the server has
  // it now: the edit sends its media back, and the card's copy may be older.
  // A post with a poll is refused: an edit without the poll removes it on
  // Mastodon, and one with it starts the poll again.
  private onEdit = async () => {
    const post = this.shownPost()
    const owner = currentOwner()
    if (!this.mine || !post || !owner) return
    if (post.poll) {
      toast('error', POLL_EDIT_REFUSED)
      return
    }
    let current: Status
    let source: StatusSource
    try {
      current = await owner.client.fetchStatus(post.id)
      if (!stillOwner(owner)) return
      if (current.poll) {
        toast('error', POLL_EDIT_REFUSED)
        return
      }
      source = await owner.client.fetchStatusSource(post.id)
    } catch {
      if (stillOwner(owner)) toast('error', 'Could not open this post for editing. Try again.')
      return
    }
    if (!stillOwner(owner)) return
    const status = mergeStatus(current)
    window.dispatchEvent(new CustomEvent('caribou:compose', { detail: { edit: { status, source } } }))
  }

  /** Focuses the post itself, for a keyboard reader whose place just went. */
  async focusPost() {
    await this.updateComplete
    const article = this.renderRoot.querySelector('article')
    article?.setAttribute('tabindex', '-1')
    article?.focus()
  }

  // The card a keyboard reader goes to when this one leaves the list: the
  // next shown post, else the one before.
  private neighbour(): CaribouStatusCard | null {
    const row = this.closest('li')
    if (!row) return null
    const shown = (li: Element | null) => {
      const card = li?.querySelector(':scope > caribou-status-card, caribou-status-card')
      return card instanceof CaribouStatusCard && !card.hidden && card !== this ? card : null
    }
    for (let li = row.nextElementSibling; li; li = li.nextElementSibling) {
      const c = shown(li)
      if (c) return c
    }
    for (let li = row.previousElementSibling; li; li = li.previousElementSibling) {
      const c = shown(li)
      if (c) return c
    }
    return null
  }

  // The post leaves at once; focus goes to its neighbour. A failure brings
  // it back, and focus to its menu.
  private async deleteAndMoveFocus(owner: Owner, post: Status): Promise<Status | null> {
    const next = this.neighbour()
    const deleting = deleteOwnStatus(owner.client, post)
    if (next) void next.focusPost()
    const gone = await deleting
    if (!gone && stillOwner(owner)) void this.focusIn('caribou-menu.more')
    return gone
  }

  private onDelete = async () => {
    const post = this.shownPost()
    const owner = currentOwner()
    if (!this.mine || !post || !owner) return
    const ok = await confirmDialog({
      title: 'Delete this post?',
      message: 'The post goes from your server and from everyone who can still reach it. You cannot undo this.',
      confirmLabel: 'Delete',
    })
    if (!ok || !stillOwner(owner)) return
    if (await this.deleteAndMoveFocus(owner, post)) toast('info', 'Post deleted')
  }

  // Deletes the post, then opens a new one with what it had. Boosts,
  // favourites and replies stay with the deleted post.
  private onRedraft = async () => {
    const post = this.shownPost()
    const owner = currentOwner()
    if (!this.mine || !post || !owner) return
    const ok = await confirmDialog({
      title: 'Delete and redraft this post?',
      message: 'The post is deleted and opens again as a new draft. Its boosts, favourites and replies are lost.'
        + (post.poll ? ' The poll is not kept.' : ''),
      confirmLabel: 'Delete & redraft',
    })
    if (!ok || !stillOwner(owner)) return
    const gone = await this.deleteAndMoveFocus(owner, post)
    if (!gone || !stillOwner(owner)) return
    const draft = redraftOf(gone, post)
    // The post it replied to, when this page has it, so the dialog shows it.
    const inReplyTo = draft.inReplyToId ? statusCache.peek().get(draft.inReplyToId) : undefined
    window.dispatchEvent(new CustomEvent('caribou:compose', {
      detail: { redraft: draft, ...(inReplyTo ? { inReplyTo } : {}) },
    }))
  }

  private onHistory = () => {
    const post = this.status?.reblog ?? this.status
    const owner = currentOwner()
    if (!this.canAct || !post || !owner) return
    void showStatusHistory(owner.client, post.id)
  }

  private onReply = () => {
    if (!this.canAct || !this.status) return
    window.dispatchEvent(new CustomEvent('caribou:compose', {
      detail: { inReplyTo: this.status.reblog ?? this.status },
    }))
  }

  private onFavourite = () => {
    if (this.canAct && this.status) void toggleFavourite(this.status)
  }

  private onBoost = () => {
    if (this.canAct && this.status && this.canBoost(this.status.reblog ?? this.status)) {
      void toggleReblog(this.status)
    }
  }

  private onBookmark = () => {
    if (this.canAct && this.status) void toggleBookmark(this.status)
  }

  // Mastodon: nobody boosts a direct post, and only its author boosts a
  // followers-only one.
  private canBoost(post: Status): boolean {
    if (post.visibility === 'direct') return false
    if (post.visibility === 'private') return this.ownPost
    return true
  }

  private renderActions(post: Status) {
    const f = this.liveFields ?? actionFields(post)
    const off = !this.canAct
    const boostable = this.canBoost(post)
    const boostHint = !boostable
      ? 'This post cannot be boosted'
      : off ? 'Sign in to boost' : ''
    const count = (n: number) => n > 0 ? String(n) : ''
    // The label names the action; the description carries the count and
    // the hint a mouse user reads in the title.
    const describe = (...parts: string[]) => parts.filter(Boolean).join('. ')
    const hint = (verb: string) => off ? `Sign in to ${verb}` : ''
    return html`
      <div class="actions" role="group" aria-label="Post actions">
        <caribou-icon-button class="reply" variant="ghost" icon="messageCircle" label="Reply"
          count=${count(f.repliesCount)} hint=${hint('reply')}
          description=${describe(plural(f.repliesCount, 'reply', 'replies'), hint('reply'))}
          ?soft-disabled=${off}
          @click=${this.onReply}></caribou-icon-button>
        <caribou-icon-button class="boost" variant="ghost" icon="repeat2" label=${f.reblogged ? 'Undo boost' : 'Boost'}
          pressed=${f.reblogged ? 'true' : 'false'}
          count=${count(f.reblogsCount)} hint=${boostHint}
          description=${describe(plural(f.reblogsCount, 'boost', 'boosts'), boostHint)}
          ?soft-disabled=${off || !boostable}
          @click=${this.onBoost}></caribou-icon-button>
        <caribou-icon-button class="favourite" variant="ghost" icon="star" label=${f.favourited ? 'Unfavourite' : 'Favourite'}
          pressed=${f.favourited ? 'true' : 'false'}
          count=${count(f.favouritesCount)} hint=${hint('favourite')}
          description=${describe(plural(f.favouritesCount, 'favourite', 'favourites'), hint('favourite'))}
          ?soft-disabled=${off}
          @click=${this.onFavourite}></caribou-icon-button>
        <caribou-icon-button class="bookmark" variant="ghost" icon="bookmark" label=${f.bookmarked ? 'Remove bookmark' : 'Bookmark'}
          pressed=${f.bookmarked ? 'true' : 'false'}
          hint=${hint('bookmark')} description=${hint('bookmark')}
          ?soft-disabled=${off}
          @click=${this.onBookmark}></caribou-icon-button>
        ${this.mine ? this.renderOwnMenu() : this.canAct && !this.ownPost ? this.renderMenu(post) : nothing}
      </div>
    `
  }

  private renderMenu(post: Status) {
    const acct = post.account.acct
    const { muting, blocking } = this.authorRel
    // Native: items in a <caribou-menu> (README, "Shared controls").
    return html`<caribou-menu class="more" anchored icon="ellipsis" label=${`More actions for post by @${acct}`}>
      <button type="button" class="menu-item" data-action="mute"
        @click=${this.onMute}>${muting ? 'Unmute' : 'Mute'} @${acct}</button>
      <button type="button" class=${blocking ? 'menu-item' : 'menu-item danger'} data-action="block"
        @click=${this.onBlock}>${blocking ? 'Unblock' : 'Block'} @${acct}</button>
    </caribou-menu>`
  }

  // The server and the first client render show the plain mark; a reader
  // who can ask the server for the history gets a button after mount.
  private renderEdited(editedAt: string) {
    const when = this.relativeTime ? formatRelativeTime(editedAt) : absoluteLabel(editedAt)
    return this.canAct
      ? html`<caribou-button class="edited" data-action="history" hint=${`Edited ${when}`}
          label=${`Edited ${when}. Show edit history`} @click=${this.onHistory}>edited</caribou-button>`
      : html`<span class="edited" title=${`Edited ${when}`}>edited</span>`
  }

  private renderOwnMenu() {
    // Native: items in a <caribou-menu> (README, "Shared controls").
    return html`<caribou-menu class="more" anchored icon="ellipsis" label="More actions for your post">
      <button type="button" class="menu-item" data-action="edit" @click=${this.onEdit}>Edit</button>
      <button type="button" class="menu-item danger" data-action="delete" @click=${this.onDelete}>Delete</button>
      <button type="button" class="menu-item danger" data-action="redraft" @click=${this.onRedraft}>Delete &amp; redraft</button>
    </caribou-menu>`
  }

  // Avatars sometimes truncate mid-response under CDN load
  // (`net::ERR_CONNECTION_CLOSED` arrives with a 200 status — the headers
  // landed but the bytes didn't). Bounded retry: clear `src`, restore it
  // after a short backoff, give up after two attempts and dim the broken
  // avatar so layout stays intact. The retry budget resets when `src`
  // changes (status update → new URL).
  private onAvatarError = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement
    const currentSrc = img.src
    if (this.retryUrl !== currentSrc) {
      this.retryUrl = currentSrc
      this.retries = 0
    }
    if (this.retries >= 2) {
      img.style.opacity = '0.4'
      return
    }
    this.retries += 1
    img.removeAttribute('src')
    this.retryTimer = setTimeout(() => {
      // A render during the backoff may have written a newer URL; keep it.
      if (!img.hasAttribute('src')) img.setAttribute('src', currentSrc)
    }, 300 * this.retries)
  }

  // Mention links in the body point at the author's instance. Route a plain
  // click on one to Caribou's own profile page instead, leaving the HTML
  // string alone: the sanitizers and the hydration digest never see a change,
  // and without JavaScript, or on a new-tab click, the link still opens the
  // instance's real profile. A hashtag the post lists in `tags` opens
  // Caribou's tag page the same way. Other links are left to the browser.
  //
  // The anchor's `target` is not a guard here, unlike `spaClick`: it comes
  // from the remote server's HTML, not from the reader. A reader who wants a
  // new tab still gets one through the modifier keys or the middle button.
  private onContentClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const content = e.currentTarget as HTMLElement
    const a = (e.target as Element).closest?.('a')
    if (!a || !content.contains(a)) return
    // The copy the body shows, so a hashtag or mention an edit added counts.
    const display = this.shownPost()
    const tag = hashtagOf(a, display?.tags)
    if (tag) {
      e.preventDefault()
      const href = tagPath(tag)
      void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(href))
      return
    }
    if (!a.matches('.mention') || a.matches('.hashtag')) return
    const mention = display?.mentions?.find((m) => sameUrl(m.url, a.href))
    if (!mention) return
    e.preventDefault()
    const href = this.profileHref(mention)
    void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(href))
  }

  // `acct` is relative to the instance the status came from. The account
  // URL's host is a last resort for a card that knows no instance: on a
  // server whose web domain differs from its account domain it names the
  // wrong host, and the profile lookup then fails the way a mistyped handle
  // does.
  private profileHref(account: { acct: string; url?: string | null }): string {
    return profilePath(account.acct, this.instance || this.shellInstance || hostOf(account.url ?? ''))
  }

  // The page's `pageData` pre-sanitizes on the server with the jsdom-backed
  // sanitizer, and DOMPurify cannot run there (no window), so the server
  // trusts that string. The client re-sanitizes as defense-in-depth for
  // poll-fetched content.
  //
  // One exception: the render that hydrates a server-made shadow root.
  // `unsafeHTML` hydration compares a digest of the HTML string, so a
  // one-character difference between the two sanitizers' output would throw
  // and break the whole page. That string is already in the DOM, so trusting
  // it for this one render exposes nothing new; the next render re-sanitizes.
  //
  // The server test is `typeof window`, not Lit's `isServer`: the unit tests
  // load Lit's node build, where `isServer` is true even with a DOM present.
  private safeContent(content: string): string {
    if (typeof window === 'undefined') return content
    if (this.adoptedServerRender && !this.hasUpdated) return content
    return DOMPurify.sanitize(content, PURIFY_OPTS)
  }

  override render() {
    const s = this.status
    this.hiddenNow = false
    this.renderedPost = false
    if (!s) return nothing
    if (this.deleted) {
      // The post the reader opened stays, as a note; any other card goes.
      if (this.variant !== 'focused') {
        this.hiddenNow = true
        return nothing
      }
      return html`<article data-variant=${this.variant} class="deleted"><div class="notice">
        <p>You deleted this post.</p>
      </div></article>`
    }
    if (this.moderated) {
      const { verb, account } = this.moderated
      // The button's name carries what it undoes: a description in this
      // root cannot reach the shared button's inner one.
      return html`<article data-variant=${this.variant} class="moderated"><div class="notice">
        <p id="moderated-msg">You ${verb} @${account.acct}.</p>
        <caribou-button class="undo" variant="secondary"
          @click=${this.onUndoModerate}>Undo<span class="vh"> ${verb === 'muted' ? 'mute' : 'block'} of @${account.acct}</span></caribou-button>
      </div></article>`
    }
    // The server and the hydrating render read the status they were given;
    // after mount the effect keeps `liveVerdict` from the newest copy.
    const verdict = this.liveVerdict !== undefined
      ? this.liveVerdict
      : filterVerdict(s, this.filterContext || null)
    // The post the reader opened is never removed: a hide filter, a mute or
    // a block covers it with a note instead.
    const focused = this.variant === 'focused'
    if (!focused && (verdict?.action === 'hide' || this.relHidden)) {
      this.hiddenNow = true
      return nothing
    }
    const why = focused && this.relHidden ? this.relWhy : null
    // The reader's filters for this post are not known yet, or could not be
    // learned: cover it.
    const checking = this.readerCheck === 'pending' || this.readerCheck === 'failed'
    const unchecked = !verdict && !why && checking
    this.coverIsUnchecked = unchecked
    if (verdict || why || unchecked) {
      const shown = unchecked ? this.uncheckedShown : this.filterShown
      const titles = verdict?.titles.join(', ') ?? ''
      const note = verdict
        ? html`Hidden by filter: <strong>${titles}</strong>`
        : why
        ? html`<span>You ${why.verb} @${why.acct}.</span>`
        : this.readerCheck === 'pending'
        ? html`<span>Checking this post against your filters…</span>`
        : html`<span>Could not check this post against your filters.</span>`
      // The visible word starts the name, so a voice command still finds it.
      // The Show/Hide toggle stays a native button: its aria-controls names
      // a region in this root (README, "Shared controls").
      const name = verdict
        ? `${shown ? 'Hide' : 'Show'} post hidden by filter: ${titles}`
        : why
        ? `${shown ? 'Hide' : 'Show'} post by @${why.acct}`
        : `${shown ? 'Hide' : 'Show'} post not checked against your filters`
      return html`<article data-variant=${this.variant} class="filtered">
        <div class="notice">
          <p>${note}</p>
          <button type="button" class="filter-toggle" aria-controls="filtered-post"
            aria-expanded=${shown ? 'true' : 'false'} aria-label=${name}
            @click=${this.onToggleFiltered}>${shown ? 'Hide' : 'Show'}</button>
          ${unchecked && (this.readerCheck === 'failed' || this.retrying)
            ? html`<caribou-button class="retry" variant="secondary" ?loading=${this.retrying}
                @click=${this.onRetryCheck}>Retry<span class="vh"> checking this post</span></caribou-button>`
            : nothing}
        </div>
        <div class="filtered-post" id="filtered-post" ?hidden=${!shown}>${shown ? this.renderPostShown(s) : nothing}</div>
      </article>`
    }
    return html`<article data-variant=${this.variant}>${this.renderPostShown(s)}</article>`
  }

  private renderPostShown(s: Status) {
    this.renderedPost = true
    return this.renderPost(s)
  }

  private renderPost(s: Status) {
    // For reblogs the rendered post is the inner status — boosts ARE the
    // inner post in Mastodon's data model. The wrapper carries only the
    // booster's account + a createdAt for "when this was boosted to my
    // timeline". Render the inner content as the body, prepend a small
    // attribution row that names the booster.
    const display = withEdit(s.reblog ?? s, this.liveEdit)
    const quote = this.liveQuote !== undefined ? this.liveQuote : display.quote
    const dt = display.createdAt
    const timeLabel = this.relativeTime ? formatRelativeTime(dt) : absoluteLabel(dt)
    const boostName = s.reblog ? (s.account.displayName || s.account.username) : null
    const authorName = display.account.displayName || display.account.username
    // A post with a content warning shows only the warning until the reader
    // opens it. The body region is empty until then, so no media or link
    // card loads.
    const warning = display.spoilerText ?? ''
    const bodyShown = warning === '' || this.warningOpen
    // Permalink: anchor on the timestamp, not the whole article — wrapping the
    // <article> would put the post-content links (hashtags, mentions, external
    // urls) inside an <a>, and the HTML parser closes the outer anchor when
    // it sees the inner one. The timestamp anchor is the no-JS-safe primitive.
    // `<litro-link>` keeps that anchor (the server renders it) and turns a
    // plain click into a client-side navigation to the thread.
    //
    // The author link is a sibling of the permalink, never around it: avatar,
    // name and acct are one link, so a keyboard user tabs once and a screen
    // reader hears the name once (the avatar's `alt` is empty).
    // One element around it all: happy-dom drops a child binding at the
    // top level of a template (README, Tests).
    // Show more / Show less stays a native button: its aria-controls names
    // the body in this root (README, "Shared controls").
    return html`<div class="post">
        ${boostName
          ? html`<div class="boost-attribution">
                   <caribou-icon class="boost-icon" name="repeat2"></caribou-icon>
                   <span><a href=${this.profileHref(s.account)} @click=${spaClick}>${boostName}</a> boosted</span>
                 </div>`
          : nothing}
        <div class="row">
          <div class="body">
            <header>
              <a class="author" href=${this.profileHref(display.account)} @click=${spaClick}>
                <img src=${display.account.avatarStatic || display.account.avatar}
                     alt=""
                     width="48" height="48"
                     loading="lazy"
                     decoding="async"
                     @error=${this.onAvatarError} />
                <strong>${authorName}</strong>
                <span class="acct">@${display.account.acct}</span>
              </a>
              <litro-link class="permalink" href=${statusPermalink(display)}>
                <time datetime=${dt}>${timeLabel}</time>
              </litro-link>
              ${display.editedAt ? this.renderEdited(display.editedAt) : nothing}
            </header>
            ${warning
              ? html`<div class="warning">
                       <p class="spoiler">${warning}</p>
                       <button type="button" class="cw-toggle" aria-controls="status-body"
                         aria-expanded=${this.warningOpen ? 'true' : 'false'}
                         @click=${this.onToggleWarning}>${this.warningOpen ? 'Show less' : 'Show more'}</button>
                     </div>`
              : nothing}
            <div class="status-body" id="status-body" ?hidden=${!bodyShown}>
              ${bodyShown ? html`<div class="status-content" @click=${this.onContentClick}>${unsafeHTML(this.safeContent(display.content ?? ''))}</div>` : nothing}
              ${bodyShown && display.poll ? html`<caribou-status-poll .status=${display} ?interactive=${this.canAct}></caribou-status-poll>` : nothing}
              ${bodyShown && display.mediaAttachments?.length ? html`<caribou-status-media .media=${display.mediaAttachments} ?sensitive=${display.sensitive === true} ?revealed=${warning !== ''}></caribou-status-media>` : nothing}
              ${bodyShown && display.card && !display.mediaAttachments?.length ? html`<caribou-status-link-card .card=${display.card}></caribou-status-link-card>` : nothing}
              ${bodyShown && quote ? html`<caribou-status-quote .quote=${quote} instance=${this.instance} filter-context=${this.filterContext}></caribou-status-quote>` : nothing}
            </div>
            ${this.renderActions(display)}
          </div>
        </div>
      </div>`
  }
}
