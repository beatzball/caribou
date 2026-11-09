import { LitElement, html, css, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import {
  activeClient, activeUser, activeUserKey, userName, editOwnStatus, findRedraftSlot, isDraftEmpty, newestKnownStatus, olderEdit,
  draftSlot, emptyDraft, loadDraft, postDraft, saveDraft,
  pollOptions, blueskyDraftInput, cacheStatus, emptyBlueskyDraft, postBlueskyDraft, statusCache, BLUESKY_SELF_LABELS, DraftChanged, DraftNotSaved,
  type BlueskyDraft, type BlueskyDraftImage, type ComposeDraft, type DraftMedia, type DraftPoll, type DraftSlot,
  type UserSession,
} from '@beatzball/caribou-state'
import {
  CaribouError, MASTODON_CAPABILITIES, MediaProcessingTimeout, type CaribouClient, type AccountCredentials,
  type Capabilities, type Status, type StatusSource, type StatusVisibility,
} from '@beatzball/caribou-mastodon-client'
import { BlueskyBlobNotFound } from '@beatzball/caribou-bluesky-client'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'
import './caribou-icon-button.js'
import { countChars, plainText, replyMentions, replyVisibility } from './_compose-text.js'
import { draftMediaOf, POLL_EDIT_REFUSED } from './_redraft.js'
import './caribou-menu.js'
import { loadBluesky, type BlueskyBrowser } from './_bluesky.js'
import { fitImage, type FitResult } from './_image-fit.js'

/**
 * What `caribou:compose` asks for: a new post, a reply to `inReplyTo`, an
 * edit of the reader's own post (`edit`, with its source text), or a new
 * post filled from a deleted one (`redraft`, with `inReplyTo` when the
 * page has the post it replied to).
 */
export interface ComposeDetail {
  inReplyTo?: Status
  edit?: { status: Status; source: StatusSource }
  redraft?: ComposeDraft
  /** A Bluesky post to quote. Only a Bluesky account can quote. */
  quote?: Status
}

/** The counts the counter and the Post button read for a Bluesky post. */
type BlueskyCount = { graphemes: number; bytes: number }

// Why a Bluesky reply or quote cannot be sent, from the post's own flags.
const REPLY_LIMITED = 'The author limited replies. You cannot reply to this post.'
const QUOTE_LIMITED = 'The author turned off quotes for this post.'
const REPLY_GONE = 'The post you replied to was deleted.'
const QUOTE_GONE = 'The post you quoted was deleted.'

/** A reader-facing reason an image was not added. */
function fitRefusal(name: string, reason: Exclude<FitResult, { ok: true }>['reason']): string {
  if (reason === 'not-image') return `${name} is not an image. A Bluesky post takes images only.`
  if (reason === 'unreadable') return `${name} could not be read as an image.`
  return `${name} is too large, even made smaller. Pick an image under 2 MB.`
}

/** The status cache's copy of a post, if it has one. */
function cachedCopy(post: Status): Status | undefined {
  return statusCache.peek().get(post.id)
}

/** Who a late answer belongs to (rule 4, `packages/state` README). */
interface Owner { client: CaribouClient; session: number; slot: DraftSlot }

/** `/@<did>/<rkey>` for `at://<did>/app.bsky.feed.post/<rkey>` (spec 8.4). */
function ownPostPath(uri: string): string {
  const [did = '', , rkey = ''] = uri.replace(/^at:\/\//, '').split('/')
  return `/@${did}/${encodeURIComponent(rkey)}`
}

/** Strong refs of a Bluesky post, or null for a post that is not one. */
function refOf(post: Status): { uri: string; cid: string } | null {
  return post.bluesky ? { uri: post.bluesky.uri, cid: post.bluesky.cid } : null
}

interface PollLimits { maxOptions: number; maxChars: number; minExpiration: number; maxExpiration: number }

interface Limits { maxChars: number; maxMedia: number; accept: string; polls: PollLimits }

// Mastodon's own defaults, for a server that does not say.
const DEFAULT_POLL_LIMITS: PollLimits = { maxOptions: 4, maxChars: 50, minExpiration: 300, maxExpiration: 2_629_746 }

const DEFAULT_ACCEPT = 'image/*,video/*,audio/*'

// The network's own limits, for a server that does not say.
function defaultLimits(caps: Capabilities): Limits {
  return { maxChars: caps.maxChars, maxMedia: caps.maxImages, accept: DEFAULT_ACCEPT, polls: DEFAULT_POLL_LIMITS }
}

const DEFAULT_LIMITS = defaultLimits(MASTODON_CAPABILITIES)

const HOUR = 3600
const DAY = 24 * HOUR
const POLL_DURATIONS: { seconds: number; label: string }[] = [
  { seconds: 5 * 60, label: '5 minutes' },
  { seconds: 30 * 60, label: '30 minutes' },
  { seconds: HOUR, label: '1 hour' },
  { seconds: 6 * HOUR, label: '6 hours' },
  { seconds: 12 * HOUR, label: '12 hours' },
  { seconds: DAY, label: '1 day' },
  { seconds: 3 * DAY, label: '3 days' },
  { seconds: 7 * DAY, label: '7 days' },
]

const inRange = (limits: PollLimits, seconds: number) =>
  seconds >= limits.minExpiration && seconds <= limits.maxExpiration

/** "2 days", "2 hours 30 minutes". */
export function durationLabel(seconds: number): string {
  const units: [number, string][] = [[DAY, 'day'], [HOUR, 'hour'], [60, 'minute']]
  const parts: string[] = []
  let rest = Math.round(seconds)
  for (const [size, name] of units) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0) parts.push(`${n} ${name}${n === 1 ? '' : 's'}`)
  }
  return parts.join(' ') || `${seconds} seconds`
}

/** The durations the server allows. A stored one in range but not listed is kept. */
function pollDurations(limits: PollLimits, current: number | null): { seconds: number; label: string }[] {
  const allowed = POLL_DURATIONS.filter((d) => inRange(limits, d.seconds))
  if (current !== null && inRange(limits, current) && !allowed.some((d) => d.seconds === current)) {
    allowed.push({ seconds: current, label: durationLabel(current) })
    allowed.sort((a, b) => a.seconds - b.seconds)
  }
  return allowed
}

/** `seconds`, moved into the server's range. */
function fitDuration(limits: PollLimits, seconds: number): number {
  return Math.min(Math.max(seconds, limits.minExpiration), limits.maxExpiration)
}

function newPoll(limits: PollLimits): DraftPoll {
  const expiresIn = Math.min(Math.max(DAY, limits.minExpiration), limits.maxExpiration)
  return { options: ['', ''], expiresIn, multiple: false, hideTotals: false }
}

/**
 * Why a poll cannot be posted yet, or null. Checked against the limits the
 * dialog has now, which may have come in after the options were written, or
 * be newer than a stored draft.
 */
function pollProblem(poll: DraftPoll, limits: PollLimits): string | null {
  if (poll.options.length > limits.maxOptions) return `This server allows at most ${limits.maxOptions} options.`
  const filled = poll.options.map((o) => o.trim())
  const long = filled.findIndex((o) => [...o].length > limits.maxChars)
  if (long >= 0) return `Option ${long + 1} is longer than ${limits.maxChars} characters.`
  if (filled.some((o) => o === '')) return 'Every option needs text.'
  const seen = new Set(filled.map((o) => o.toLocaleLowerCase()))
  if (seen.size < filled.length) return 'Two options are the same.'
  return null
}

/** A limit problem shows at once; a blank or a repeat once the reader has started. */
function limitProblem(poll: DraftPoll, limits: PollLimits): boolean {
  return poll.options.length > limits.maxOptions
    || poll.options.some((o) => [...o.trim()].length > limits.maxChars)
}

// One fetch per server for the page's lifetime; the limits rarely change.
const limitsByServer = new Map<string, Promise<Limits>>()

function fetchLimits(client: CaribouClient, server: string): Promise<Limits> {
  let p = limitsByServer.get(server)
  if (!p) {
    const base = defaultLimits(client.capabilities)
    p = client.fetchInstance().then((i) => ({
      maxChars: i.configuration?.statuses?.maxCharacters ?? base.maxChars,
      maxMedia: i.configuration?.statuses?.maxMediaAttachments ?? base.maxMedia,
      accept: i.configuration?.mediaAttachments?.supportedMimeTypes?.join(',') || base.accept,
      polls: {
        maxOptions: i.configuration?.polls?.maxOptions ?? DEFAULT_POLL_LIMITS.maxOptions,
        maxChars: i.configuration?.polls?.maxCharactersPerOption ?? DEFAULT_POLL_LIMITS.maxChars,
        minExpiration: i.configuration?.polls?.minExpiration ?? DEFAULT_POLL_LIMITS.minExpiration,
        maxExpiration: i.configuration?.polls?.maxExpiration ?? DEFAULT_POLL_LIMITS.maxExpiration,
      },
    })).catch(() => {
      limitsByServer.delete(server)
      return base
    })
    limitsByServer.set(server, p)
  }
  return p
}

// An item still being uploaded lives only here; it joins the stored draft
// once the server has it.
// Fields where a plain Enter would submit the form. Not a file picker,
// where Enter opens the file chooser.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number'])

function isTextInput(t: EventTarget | undefined): boolean {
  return t instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(t.type)
}

interface PendingMedia {
  localId: string
  file: File
  previewUrl: string
  description: string
  state: 'uploading' | 'failed'
  // Set when the upload worked but processing outlasted the wait: a retry
  // waits on this id instead of uploading the file again.
  mediaId?: string
}

// What follows "Remove", "Retry" or "Alt text for" on each attachment, so
// that every control has its own name: the kind and place, then the file
// name when there is one, "image 2, image.jpeg". The place is always there:
// a phone names every photo it hands over the same, "image.jpeg".
function mediaLabel(name: string | undefined, kind: string, position: number): string {
  const noun = kind.startsWith('image') || kind === 'gifv' ? 'image'
    : kind.startsWith('video') ? 'video'
    : kind.startsWith('audio') ? 'audio' : 'file'
  return name ? `${noun} ${position}, ${name}` : `${noun} ${position}`
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// The account's own default, once `loadActiveAccount` has stored the
// verify_credentials body (it carries `source`). Until then, public.
function defaultVisibility(user: UserSession): StatusVisibility {
  const privacy = (user.account as Partial<AccountCredentials> | null)?.source?.privacy
  return privacy && ['public', 'unlisted', 'private', 'direct'].includes(privacy) ? privacy : 'public'
}

const VISIBILITIES: { value: StatusVisibility; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Followers only' },
  { value: 'direct', label: 'Mentioned people only' },
]

function toast(kind: 'error' | 'info', message: string): void {
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind, message } }))
}

// Every page renders its own app shell, so during a page swap two dialogs
// are mounted at once. Only the newest one answers, or both would open.
const mounted: CaribouComposeDialog[] = []

@customElement('caribou-compose-dialog')
export class CaribouComposeDialog extends LitElement {
  static override styles = [boxReset, css`
    :host { display: contents; }
    dialog {
      width: min(600px, calc(100vw - 2 * var(--space-4)));
      /* dvh follows the visible area as Safari's toolbars come and go; the
         insets keep Post and Cancel out of the home-indicator zone. */
      max-height: calc(100vh - 2 * var(--space-4));
      max-height: calc(100dvh - 2 * var(--space-4)
        - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
      padding: 0; border: 1px solid var(--border); border-radius: var(--radius-lg);
      background: var(--bg-0); color: var(--fg-0);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    form { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
    header { display: flex; justify-content: space-between; align-items: center; }
    h2 { margin: 0; font-size: 1.1em; }
    .reply-to {
      border-left: 3px solid var(--border); padding-left: var(--space-3);
      color: var(--fg-1); max-height: 8em; overflow: auto; white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .reply-to strong { color: var(--fg-0); }
    .acct { color: var(--fg-muted); }
    textarea, input[type="text"], select {
      width: 100%; font: inherit; color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-2);
    }
    textarea { min-height: 8em; resize: vertical; }
    .media { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .media li { display: flex; flex-direction: column; gap: var(--space-1); }
    .media img, .media .file { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); background: var(--bg-2); }
    .media .file { display: flex; align-items: center; justify-content: center; color: var(--fg-muted); }
    .media .state { font-size: 0.85em; color: var(--fg-muted); }
    .media .state[data-state="failed"] { color: var(--danger); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .toolbar select { width: auto; }
    .spacer { flex: 1; }
    .note { margin: 0; color: var(--fg-muted); font-size: 0.875rem; }
    .count { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
    .count[data-over] { color: var(--danger); }
    .toolbar select { min-block-size: 2.25rem; }
    @media (pointer: coarse) {
      .toolbar select { min-block-size: 44px; }
    }
    .poll { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); min-width: 0; }
    .poll legend { padding: 0 var(--space-1); font-weight: 600; }
    .poll ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
    .poll li { display: flex; gap: var(--space-2); align-items: center; }
    .poll li input { flex: 1; min-width: 0; }
    .poll .settings { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); align-items: center; }
    .poll .settings select { width: auto; min-block-size: 2.25rem; }
    .poll .check { display: inline-flex; gap: var(--space-2); align-items: center; min-block-size: 2.25rem; }
    @media (pointer: coarse) {
      .poll .settings select, .poll .check { min-block-size: 44px; }
    }
    .poll .problem, .note.problem { color: var(--danger); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `]

  // Nothing is rendered until the first open: the server has no session,
  // so its render and the first client render are both empty, and a page
  // where nobody composes never builds the form.
  @state() private ready = false
  private open = false
  @state() private draft: ComposeDraft = emptyDraft()
  @state() private replyTo: Status | null = null
  // The reader's own post being edited. An edit is not kept as a draft,
  // keeps the post's visibility (Mastodon cannot change it) and its media.
  @state() private editing: Status | null = null
  @state() private pending: PendingMedia[] = []
  @state() private posting = false
  // Counts openings, so a post that finishes after its dialog closed knows
  // it no longer owns the dialog.
  private session = 0
  @state() private limits: Limits = DEFAULT_LIMITS
  // Bluesky only. The post being quoted, the SDK's counter once its chunk
  // has loaded, and why the reply or quote cannot be sent, if it cannot.
  @state() private quoteTo: Status | null = null
  @state() private bsky: BlueskyBrowser | null = null
  // The reply or quote target is gone (`not_found` on the fresh read).
  @state() private gone: string | null = null
  // A link to an earlier version that a retry found posted (spec 7.2).
  @state() private earlierPosted: string | null = null
  // Images (by their local id) the PDS no longer has and that this page has
  // no file for.
  @state() private missingBlobs = new Set<string>()
  // The file behind each uploaded image, by its local id, so a dropped blob
  // can go up again, and its preview. Memory only: a reload keeps the blob refs.
  private blobFiles = new Map<string, Blob>()
  private blobPreviews = new Map<string, string>()

  @query('dialog') private dialogEl?: HTMLDialogElement
  @query('textarea') private textareaEl?: HTMLTextAreaElement
  @query('#compose-visibility') private selectEl?: HTMLSelectElement
  @query('#compose-poll-duration') private durationEl?: HTMLSelectElement
  @query('input[type="file"]') private fileEl?: HTMLInputElement

  private draftKey: DraftSlot = 'new'
  private returnFocus: HTMLElement | null = null
  private showPending = false
  // The account the dialog was opened for. Every read and write goes
  // through it, so a sign-out or an account switch while the dialog is
  // open can never save the draft under, or post as, another account.
  private client: CaribouClient | null = null
  // Alt text the server has, per media id, and the save still in flight.
  private syncedAlt = new Map<string, string>()
  private altSaves = new Map<string, Promise<void>>()
  private unwatchUser?: () => void

  override connectedCallback() {
    super.connectedCallback()
    mounted.push(this)
    window.addEventListener('caribou:compose', this.onCompose)
    this.unwatchUser = effect(() => {
      const key = activeUserKey.value
      if (this.open && this.client && key !== this.client.userKey) {
        const editing = this.editing !== null
        const keptRedraft = this.keptRedraft
        this.close()
        toast('info', editing
          ? 'The edit was not saved: you switched accounts.'
          : keptRedraft
          ? 'Your redraft is saved for the account you started it with. It opens the next time you write a new post there.'
          : 'Your draft is saved for the account you started it with.')
      }
    })
  }

  override disconnectedCallback() {
    const i = mounted.indexOf(this)
    if (i >= 0) mounted.splice(i, 1)
    window.removeEventListener('caribou:compose', this.onCompose)
    this.unwatchUser?.()
    this.unwatchUser = undefined
    for (const p of this.pending) URL.revokeObjectURL(p.previewUrl)
    super.disconnectedCallback()
  }

  protected override updated() {
    // Set after render: a `selected` binding on options built inside a new
    // <select> is not applied reliably in every DOM.
    if (this.selectEl && this.selectEl.value !== this.draft.visibility) {
      this.selectEl.value = this.draft.visibility
    }
    const poll = this.draft.poll
    if (poll && this.durationEl && this.durationEl.value !== String(poll.expiresIn)) {
      this.durationEl.value = String(poll.expiresIn)
    }
    // A one-shot flag, not `open`: the browser fires `close` a task after
    // close(), and an update in between must not open the dialog again.
    if (this.showPending && this.dialogEl) {
      this.showPending = false
      if (!this.dialogEl.open) this.dialogEl.showModal()
      const ta = this.textareaEl
      if (ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }
  }

  private isActive(): boolean {
    return mounted[mounted.length - 1] === this
  }

  private onCompose = (e: Event) => {
    if (!this.isActive()) return
    const detail = (e as CustomEvent<ComposeDetail | undefined>).detail
    if (detail?.edit) this.showEdit(detail.edit.status, detail.edit.source)
    else if (detail?.redraft) this.showRedraft(detail.redraft, detail.inReplyTo ?? null)
    else if (detail?.quote) this.showQuote(detail.quote)
    else this.show(detail?.inReplyTo ?? null)
  }

  // Everything every kind of opening shares. False when the dialog cannot
  // open: no session, or it is open already.
  private begin(): boolean {
    const client = activeClient.value
    const user = activeUser.value
    if (!client || !user || this.open) return false
    const active = document.activeElement
    this.returnFocus = active instanceof HTMLElement ? deepActive(active) : null
    this.client = client
    this.limits = defaultLimits(client.capabilities)
    this.session += 1
    this.posting = false
    this.syncedAlt = new Map()
    this.altSaves = new Map()
    this.replyTo = null
    this.editing = null
    this.pending = []
    this.quoteTo = null
    this.gone = null
    this.earlierPosted = null
    this.missingBlobs = new Set()
    if (this.isBluesky) {
      const session = this.session
      this.bsky = null
      void loadBluesky().then(
        (m) => { if (session === this.session) this.bsky = m },
        () => { if (session === this.session) toast('error', 'Could not load Bluesky. Check your connection and open the composer again.') },
      )
    }
    return true
  }

  private finishOpen() {
    this.open = true
    this.showPending = true
    this.ready = true
    const client = this.client
    const user = activeUser.value
    // Bluesky's limits are the lexicon's, in `capabilities`.
    if (client && user && !this.isBluesky) {
      const session = this.session
      void fetchLimits(client, user.server ?? user.userKey).then((l) => {
        this.limits = l
        // A poll made before the limits came in, or kept in a draft from
        // before the server changed them, may be out of range.
        const poll = this.draft.poll
        if (session === this.session && poll && !inRange(l.polls, poll.expiresIn)) {
          this.patchPoll({ expiresIn: fitDuration(l.polls, poll.expiresIn) })
        }
      })
    }
  }

  /**
   * Opens the dialog on the reader's own post, filled with its source text.
   * Saving replaces the post's text and content warning; visibility and
   * media stay as they are.
   */
  showEdit(status: Status, source: StatusSource): void {
    if (!this.begin()) return
    this.editing = status
    this.draftKey = 'new'
    this.draft = emptyDraft({
      text: source.text,
      spoilerText: source.spoilerText,
      cw: source.spoilerText !== '',
      visibility: status.visibility,
      inReplyToId: status.inReplyToId ?? null,
      media: (status.mediaAttachments ?? []).map(draftMediaOf),
      sensitive: status.sensitive === true,
      language: status.language ?? null,
    })
    this.finishOpen()
  }

  // The open draft is a redraft kept beside another draft (`redraft:<key>`).
  private get keptRedraft(): boolean {
    return this.draftKey.startsWith('redraft:')
  }

  /**
   * Opens a new post filled from a deleted one, stored as a draft at once:
   * the deleted post is nowhere else. It goes in its own slot, unless that
   * slot holds an unsent draft. That one is never overwritten; the redraft
   * is then kept in a `redraft:<key>` slot, which the next new post opens
   * first.
   */
  showRedraft(draft: ComposeDraft, inReplyTo: Status | null = null): void {
    if (!this.begin()) return
    const client = this.client!
    const slot = draftSlot(draft.inReplyToId)
    const held = loadDraft(client.userKey, slot)
    this.replyTo = inReplyTo && inReplyTo.id === draft.inReplyToId ? inReplyTo : null
    this.draft = draft
    this.draftKey = held && !isDraftEmpty(held) ? `redraft:${draft.idempotencyKey}` : slot
    saveDraft(client.userKey, this.draftKey, draft)
    this.finishOpen()
  }

  /** Opens the dialog for a new post, or a reply to `inReplyTo`. */
  show(inReplyTo: Status | null): void {
    // A reply goes to a post on the active account's network only (spec 11).
    if (inReplyTo && !!inReplyTo.bluesky !== (activeClient.value?.capabilities.network === 'bluesky')) return
    if (activeClient.value?.capabilities.network === 'bluesky') return this.showBluesky({ inReplyTo })
    if (!this.begin()) return
    const user = activeUser.value!
    const client = this.client!
    // A kept redraft opens before a plain new post, so the deleted post's
    // text is never left behind unseen.
    const redraft = inReplyTo ? null : findRedraftSlot(client.userKey)
    this.draftKey = redraft ?? draftSlot(inReplyTo?.id)
    this.replyTo = inReplyTo
    const visibility = defaultVisibility(user)
    this.draft = loadDraft(client.userKey, this.draftKey) ?? (inReplyTo
      ? emptyDraft({
        text: replyMentions(inReplyTo, userName(user)),
        visibility: replyVisibility(inReplyTo.visibility, visibility),
        inReplyToId: inReplyTo.id,
        cw: inReplyTo.spoilerText !== '',
        spoilerText: inReplyTo.spoilerText,
      })
      : emptyDraft({ visibility }))
    this.finishOpen()
  }

  /** Opens the dialog to quote a Bluesky post, with the active Bluesky account. */
  showQuote(quote: Status): void {
    if (activeClient.value?.capabilities.network !== 'bluesky' || !quote.bluesky) return
    this.showBluesky({ quote })
  }

  // A Bluesky post: a new one, a reply or a quote. Its draft holds the
  // strong refs (README, "Bluesky compose").
  private showBluesky({ inReplyTo, quote }: { inReplyTo?: Status | null; quote?: Status }): void {
    if (!this.begin()) return
    const client = this.client!
    const target = inReplyTo ?? quote ?? null
    const ref = target ? refOf(target) : null
    if (target && !ref) return
    const redraft = target ? null : findRedraftSlot(client.userKey)
    this.draftKey = redraft ?? (inReplyTo ? draftSlot(inReplyTo.id) : quote ? `quote:${quote.id}` : 'new')
    this.replyTo = inReplyTo ?? null
    this.quoteTo = quote ?? null
    const stored = loadDraft(client.userKey, this.draftKey)
    const bluesky: BlueskyDraft = stored?.bluesky ?? emptyBlueskyDraft(
      inReplyTo && ref ? { reply: { root: inReplyTo.bluesky!.replyRef?.root ?? ref, parent: ref } }
      : quote && ref ? { quote: ref } : {},
    )
    // No mentions are typed into a Bluesky reply: the author is in the
    // reply's refs, and a mention is addressed by DID, never by handle.
    // Each image needs a local id for its controls (one stored without it gets one).
    const images = bluesky.images.map((i) => i.id ? i : { ...i, id: crypto.randomUUID() })
    this.draft = { ...(stored ?? emptyDraft({ inReplyToId: inReplyTo?.id ?? null })), bluesky: { ...bluesky, images } }
    this.finishOpen()
    this.ensureRkey()
    if (target) void this.refreshTarget(client, target)
  }

  // R6 (`packages/state` README): a draft gets its rkey when it is made, so
  // every copy of it (a reopened dialog, a reload) posts at most one record.
  // Post waits for it.
  private ensureRkey(): void {
    const owner = this.owner()
    if (!owner || this.draft.bluesky?.rkey || !owner.client.blueskyNextRkey) return
    owner.client.blueskyNextRkey().then((rkey) => {
      if (!this.owns(owner) || this.draft.bluesky?.rkey) return
      this.draft = { ...this.draft, bluesky: { ...(this.draft.bluesky ?? emptyBlueskyDraft()), rkey } }
      // Stored with the draft (an empty draft is not stored; its next save is).
      saveDraft(owner.client.userKey, owner.slot, this.draft)
    }, (err: unknown) => {
      if (this.owns(owner)) toast('error', `Could not get the post ready: ${errorText(err)}. Open the composer again.`)
    })
  }

  private get isBluesky(): boolean {
    return (this.client ?? activeClient.value)?.capabilities.network === 'bluesky'
  }

  // The second check (#188 owns the buttons): a reply or quote to a post
  // whose author turned it off cannot be sent, whatever opened the dialog.
  // Why this reply or quote cannot be sent, or null. Read live: blocked
  // when the dialog's own copy **or** the status cache's says the author
  // turned it off (neither is known to be newer), or when the post is gone.
  private get blocked(): string | null {
    const replyOff = !!this.replyTo && (!!this.replyTo.bluesky?.replyDisabled || !!cachedCopy(this.replyTo)?.bluesky?.replyDisabled)
    const quoteOff = !!this.quoteTo && (!!this.quoteTo.bluesky?.embeddingDisabled || !!cachedCopy(this.quoteTo)?.bluesky?.embeddingDisabled)
    return replyOff ? REPLY_LIMITED : quoteOff ? QUOTE_LIMITED : this.gone
  }

  private owner(): Owner | null {
    return this.client ? { client: this.client, session: this.session, slot: this.draftKey } : null
  }

  // Rule 4: a late answer acts only while its dialog, account and slot are the same.
  private owns(o: Owner): boolean {
    return this.client === o.client && this.session === o.session && this.draftKey === o.slot
      && activeUserKey.peek() === o.client.userKey
  }

  // Reads the post again: its flags may have changed, or it may be gone.
  private async refreshTarget(client: CaribouClient, target: Status): Promise<void> {
    const session = this.session
    try {
      const fresh = await client.fetchStatus(target.id)
      if (session !== this.session || client !== this.client) return
      // The page's other copies learn the flags too.
      cacheStatus(fresh)
      if (this.replyTo?.id === fresh.id) this.replyTo = fresh
      if (this.quoteTo?.id === fresh.id) this.quoteTo = fresh
    } catch (err) {
      if (session !== this.session || client !== this.client) return
      if (err instanceof CaribouError && err.code === 'not_found') {
        // The draft keeps its text; it just cannot be sent there.
        this.gone = this.replyTo ? REPLY_GONE : QUOTE_GONE
      }
    }
  }

  private close() {
    this.dialogEl?.close()
  }

  // Runs for Esc, the Cancel button and a successful post alike. The draft
  // is already stored, so closing loses nothing.
  private onClose = () => {
    this.open = false
    this.client = null
    this.editing = null
    for (const p of this.pending) URL.revokeObjectURL(p.previewUrl)
    this.pending = []
    for (const url of this.blobPreviews.values()) URL.revokeObjectURL(url)
    this.blobPreviews = new Map()
    this.blobFiles = new Map()
    this.quoteTo = null
    const target = this.returnFocus
    this.returnFocus = null
    if (target?.isConnected) target.focus()
  }

  private patchDraft(patch: Partial<ComposeDraft>) {
    // The editor is read-only while posting; a late event must not change
    // the draft that is being sent, or be cleared with it.
    if (this.posting || !this.client) return
    this.draft = { ...this.draft, ...patch }
    if (!this.editing) saveDraft(this.client.userKey, this.draftKey, this.draft)
  }

  private patchBluesky(patch: Partial<BlueskyDraft>) {
    this.patchDraft({ bluesky: { ...(this.draft.bluesky ?? emptyBlueskyDraft()), ...patch } })
  }

  // The Bluesky count, or null until the SDK's chunk has loaded.
  private get bskyCount(): BlueskyCount | null {
    return this.bsky ? this.bsky.countPost(this.draft.text) : null
  }

  // What the account's network can do; a control it lacks is not shown.
  // After close (`client` is null) it stays the active account's, so a
  // closed dialog does not swap its controls to another network's.
  private get caps(): Capabilities {
    return (this.client ?? activeClient.value)?.capabilities ?? MASTODON_CAPABILITIES
  }

  // The draft as it can be sent: a content warning or a poll kept in a
  // stored draft is left out where the network has none.
  private get sendable(): ComposeDraft {
    const d = this.draft
    const caps = this.caps
    if ((caps.contentWarningText || !d.cw) && (caps.polls || !d.poll)) return d
    return { ...d, cw: caps.contentWarningText && d.cw, poll: caps.polls ? d.poll : null }
  }

  private get count(): number {
    const d = this.sendable
    return countChars(d.text, d.cw ? d.spoilerText : '')
  }

  // A poll needs text with it: Mastodon refuses a post with only a poll.
  private get canPost(): boolean {
    if (this.isBluesky) return this.canPostBluesky
    const poll = this.activePoll
    const hasContent = this.draft.text.trim() !== '' || (this.draft.media.length > 0 && !poll)
    if (poll && (pollProblem(poll, this.limits.polls) !== null || !inRange(this.limits.polls, poll.expiresIn))) return false
    return hasContent && this.count <= this.limits.maxChars
      && this.pending.length === 0 && !this.posting
  }

  // A Bluesky post may have no text when it has an image or a quote. Both
  // limits hold, counted as the PDS counts (`countPost`).
  private get canPostBluesky(): boolean {
    const b = this.draft.bluesky
    const count = this.bskyCount
    if (!b || !b.rkey || !count || !this.bsky || this.blocked || this.missingBlobs.size > 0) return false
    if (b.images.length > this.caps.maxImages) return false
    const hasContent = this.draft.text.trim() !== '' || b.images.length > 0 || b.quote !== null
    return hasContent && this.bsky.postFits(count) && this.pending.length === 0 && !this.posting
  }

  // Saves an edit. A failure leaves the post as it was and the dialog open
  // with the reader's text, so nothing is lost.
  //
  // Media, language and the poll come from the newest copy of the post this
  // page knows, which may be newer than the one the dialog opened with: an
  // edit replaces the media list, so an older one would drop new media.
  private async saveEdit(client: CaribouClient, opened: Status) {
    const known = newestKnownStatus(opened.id)
    const post = known && olderEdit(opened, known) ? known : opened
    if (post.poll) {
      toast('error', POLL_EDIT_REFUSED)
      return
    }
    const session = this.session
    const d = this.sendable
    const cw = d.cw && d.spoilerText.trim() !== ''
    this.posting = true
    try {
      const saved = await editOwnStatus(client, post.id, {
        status: d.text,
        spoilerText: cw ? d.spoilerText : '',
        // A content warning marks the media sensitive; without one the
        // media keeps the mark it had.
        sensitive: cw || (post.sensitive === true && (post.mediaAttachments?.length ?? 0) > 0),
        language: post.language ?? d.language ?? null,
        mediaIds: (post.mediaAttachments ?? []).map((m) => m.id),
      })
      if (!saved || client !== this.client || session !== this.session) return
      this.close()
      toast('info', 'Post updated')
    } catch (err) {
      toast('error', `Could not save the edit: ${errorText(err)}`)
    } finally {
      if (session === this.session) this.posting = false
    }
  }

  private async submit() {
    const client = this.client
    // A Bluesky reply or quote turned off since the last render: say why
    // (the cache can change without a render), and show the note.
    if (client && this.isBluesky && !this.posting && this.blocked) {
      toast('error', this.blocked)
      this.requestUpdate()
      return
    }
    if (!client || !this.canPost) return
    if (activeUserKey.value !== client.userKey) return
    if (this.editing) return this.saveEdit(client, this.editing)
    if (this.isBluesky) return this.submitBluesky(client)
    const done = this.replyTo ? 'Reply posted' : 'Post published'
    const session = this.session
    this.posting = true
    try {
      // Alt text is saved on `change`, which a quick Post or Ctrl+Enter in
      // the alt field can beat. Every description must be on the server
      // before the post that shows it.
      try {
        await Promise.all(this.draft.media.map((m) => this.saveAlt(m.id, m.description)))
      } catch (err) {
        toast('error', `Could not save the alt text: ${errorText(err)}`)
        return
      }
      await postDraft(client, this.draftKey, this.sendable)
      // The dialog was closed, and maybe reopened for another draft, while
      // this post was in flight. That draft is not ours to clear.
      if (client !== this.client || session !== this.session) {
        toast('info', done)
        return
      }
      this.draft = emptyDraft()
      this.close()
      toast('info', done)
    } catch (err) {
      toast('error', `Could not post: ${errorText(err)}`)
    } finally {
      if (session === this.session) this.posting = false
    }
  }

  private async submitBluesky(client: CaribouClient) {
    // The flags as this page knows them now, not as they were at open.
    if (this.blocked) {
      toast('error', this.blocked)
      return
    }
    const done = this.replyTo ? 'Reply posted' : 'Post published'
    const owner = this.owner()!
    const sentRkey = this.draft.bluesky?.rkey ?? null
    const sentInput = blueskyDraftInput(this.draft)
    this.posting = true
    this.earlierPosted = null
    try {
      const out = await postBlueskyDraft(client, owner.slot, this.draft, {
        // Rule 2: the open draft takes every draft the send makes, the
        // frozen one first, so it never holds less than storage.
        onDraft: (d) => { if (this.owns(owner)) this.draft = d },
      })
      if (!this.owns(owner)) {
        toast('info', out.kind === 'posted' ? done : 'Your earlier version was posted.')
        // The dialog was opened again on the same draft (same rkey, no edit):
        // that text is posted now, so it closes (review R4-N4).
        const open = this.draft.bluesky
        if (out.kind === 'posted' && this.open && this.client === owner.client && open?.rkey === sentRkey
          && blueskyDraftInput(this.draft) === sentInput) {
          this.draft = emptyDraft()
          this.close()
        }
        return
      }
      if (out.kind === 'earlier-posted') {
        // The edits stay open, with a new rkey; nothing more was sent.
        this.draft = out.draft
        this.earlierPosted = ownPostPath(out.uri)
        toast('info', 'Your earlier version was posted. Your edits are still here.')
        return
      }
      this.draft = emptyDraft()
      this.close()
      toast('info', done)
    } catch (err) {
      if (!this.owns(owner)) return
      if (err instanceof DraftNotSaved || err instanceof DraftChanged) toast('error', err.message)
      else if (err instanceof BlueskyBlobNotFound) await this.recoverBlob(owner, err)
      else toast('error', `Could not post: ${errorText(err).replace(/\.$/, '')}. Post again to retry; it is never sent twice.`)
    } finally {
      if (owner.session === this.session) this.posting = false
    }
  }

  // The PDS dropped an image no post used yet (spec 7.2). Upload it again
  // from the file this page still has, or ask for the file again. Each
  // await rechecks the owner (rule 4).
  private async recoverBlob(owner: Owner, err: BlueskyBlobNotFound) {
    const gone = (this.draft.bluesky?.images ?? []).filter((i) => err.cid === null || i.blob.ref.$link === err.cid)
    const missing = new Set(this.missingBlobs)
    const replaced = new Map<string, BlueskyDraftImage>()
    let uploaded = 0
    for (const img of gone) {
      const file = this.blobFiles.get(img.id)
      if (!file) {
        missing.add(img.id)
        continue
      }
      try {
        const blob = await owner.client.blueskyUploadBlob!(file)
        if (!this.owns(owner)) return
        replaced.set(img.id, { ...img, blob, size: blob.size, mime: blob.mimeType })
        uploaded += 1
      } catch (upErr) {
        if (this.owns(owner)) toast('error', `Upload failed: ${errorText(upErr)}`)
        return
      }
    }
    if (!this.owns(owner)) return
    this.missingBlobs = missing
    // Not `patchBluesky`: the editor is read-only while posting, and this
    // runs inside the send.
    const b = this.draft.bluesky ?? emptyBlueskyDraft()
    this.draft = { ...this.draft, bluesky: { ...b, images: b.images.map((i) => replaced.get(i.id) ?? i) } }
    saveDraft(owner.client.userKey, owner.slot, this.draft)
    // R5: say only what happened.
    toast('error', missing.size > 0
      ? 'The server no longer has an image. Remove it and add it again, then post.'
      : uploaded > 0
      ? 'An image was uploaded again. Post again to send.'
      : 'The server refused an image this post named. Post again to send it without it.')
  }

  private keepFile(id: string, file: Blob) {
    this.blobFiles.set(id, file)
    if (!this.blobPreviews.has(id)) this.blobPreviews.set(id, URL.createObjectURL(file))
  }

  private onSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    void this.submit()
  }

  private onFormKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      void this.submit()
    } else if (isTextInput(e.composedPath()[0])) {
      // A plain Enter in a one-line field would submit the form, and so
      // publish the post. Only Ctrl/Cmd+Enter or the Post button may.
      e.preventDefault()
    }
  }

  private onFiles = (e: Event) => {
    const input = e.target as HTMLInputElement
    const attached = this.isBluesky ? this.draft.bluesky?.images.length ?? 0 : this.draft.media.length
    const room = this.limits.maxMedia - attached - this.pending.length
    const files = [...(input.files ?? [])]
    input.value = ''
    if (files.length > room) toast('error', `You can attach up to ${this.limits.maxMedia} files.`)
    for (const file of files.slice(0, Math.max(0, room))) void (this.isBluesky ? this.uploadBluesky(file) : this.upload(file))
  }

  private async upload(file: File, retry?: PendingMedia) {
    const client = this.client
    if (!client) return
    const item: PendingMedia = retry
      ? { ...retry, state: 'uploading' }
      : { localId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), description: '', state: 'uploading' }
    this.pending = retry
      ? this.pending.map((p) => p.localId === item.localId ? item : p)
      : [...this.pending, item]
    try {
      const m = item.mediaId
        ? await client.waitForMedia(item.mediaId)
        : await client.uploadMedia(file, item.description ? { description: item.description } : {})
      // A late answer for a dialog closed, or reopened, meanwhile.
      if (client !== this.client) return
      // The item may have been removed, or the dialog closed, meanwhile.
      const current = this.pending.find((p) => p.localId === item.localId)
      if (!current) return
      this.pending = this.pending.filter((p) => p !== current)
      URL.revokeObjectURL(current.previewUrl)
      const media: DraftMedia = {
        id: m.id, type: m.type, url: m.url ?? '', previewUrl: m.previewUrl ?? null,
        description: current.description, name: current.file.name,
      }
      this.syncedAlt.set(m.id, m.description ?? '')
      this.patchDraft({ media: [...this.draft.media, media] })
      // Alt text typed while the file was uploading.
      this.saveAltOrToast(media.id, current.description)
    } catch (err) {
      // Only a timeout leaves a usable upload behind. After any other
      // failure the id may be dead, so Retry uploads the file again.
      const mediaId = err instanceof MediaProcessingTimeout ? err.mediaId : undefined
      this.pending = this.pending.map((p) => {
        if (p.localId !== item.localId) return p
        const { mediaId: _stale, ...rest } = p
        return { ...rest, state: 'failed', ...(mediaId ? { mediaId } : {}) }
      })
      toast('error', `Upload failed: ${errorText(err)}`)
    }
  }

  // An image is made small enough first (`fitImage`), then uploaded as a
  // blob. Its alt text lives in the draft and goes in the post's embed.
  private async uploadBluesky(file: File, retry?: PendingMedia) {
    const owner = this.owner()
    const client = owner?.client
    if (!owner || !client?.blueskyUploadBlob) return
    const item: PendingMedia = retry
      ? { ...retry, state: 'uploading' }
      : { localId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), description: '', state: 'uploading' }
    this.pending = retry
      ? this.pending.map((p) => p.localId === item.localId ? item : p)
      : [...this.pending, item]
    let fit: FitResult
    try {
      fit = await fitImage(file, this.caps.maxImageBytes ?? 2_000_000)
    } catch (err) {
      // A canvas that refuses to encode: the item goes, with a message.
      if (!this.owns(owner)) return
      this.removePending(item.localId)
      toast('error', `${file.name || 'The file'} could not be prepared: ${errorText(err)}`)
      return
    }
    if (!this.owns(owner)) return
    if (!fit.ok) {
      this.removePending(item.localId)
      toast('error', fitRefusal(file.name || 'The file', fit.reason))
      return
    }
    try {
      const blob = await client.blueskyUploadBlob(fit.blob)
      if (!this.owns(owner)) return
      const current = this.pending.find((p) => p.localId === item.localId)
      if (!current) return
      this.pending = this.pending.filter((p) => p !== current)
      URL.revokeObjectURL(current.previewUrl)
      const id = crypto.randomUUID()
      this.keepFile(id, fit.blob)
      const image: BlueskyDraftImage = {
        id, blob, mime: blob.mimeType, size: blob.size, alt: current.description,
        aspectRatio: fit.width > 0 && fit.height > 0 ? { width: fit.width, height: fit.height } : null,
        ...(file.name ? { name: file.name } : {}),
      }
      this.patchBluesky({ images: [...(this.draft.bluesky?.images ?? []), image] })
    } catch (err) {
      if (!this.owns(owner)) return
      this.pending = this.pending.map((p) => p.localId === item.localId ? { ...p, state: 'failed' } : p)
      toast('error', `Upload failed: ${errorText(err)}`)
    }
  }

  // By the image's local id: the same file picked twice is two images.
  private removeBlueskyImage(id: string) {
    const missing = new Set(this.missingBlobs)
    missing.delete(id)
    this.missingBlobs = missing
    const url = this.blobPreviews.get(id)
    if (url) URL.revokeObjectURL(url)
    this.blobPreviews.delete(id)
    this.blobFiles.delete(id)
    this.patchBluesky({ images: (this.draft.bluesky?.images ?? []).filter((i) => i.id !== id) })
  }

  private toggleLabel(value: string) {
    const labels = this.draft.bluesky?.labels ?? []
    this.patchBluesky({ labels: labels.includes(value) ? labels.filter((l) => l !== value) : [...labels, value] })
  }

  // Saves are chained per id, so they land in order, and one that matches
  // what the server already has sends nothing.
  private saveAlt(id: string, description: string): Promise<void> {
    const client = this.client
    if (!client) return Promise.resolve()
    const prev = this.altSaves.get(id) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(async () => {
      if ((this.syncedAlt.get(id) ?? '') === description) return
      await client.updateMedia(id, { description })
      this.syncedAlt.set(id, description)
    })
    this.altSaves.set(id, next)
    return next
  }

  private saveAltOrToast(id: string, description: string) {
    this.saveAlt(id, description).catch((err: unknown) => {
      toast('error', `Could not save the alt text: ${errorText(err)}`)
    })
  }

  // The draft's poll, when this dialog may send one: not in an edit, and
  // never beside media.
  private get activePoll(): DraftPoll | null {
    return !this.editing && this.caps.polls && this.draft.poll && this.draft.media.length === 0 ? this.draft.poll : null
  }

  private togglePoll = () => {
    if (this.draft.media.length > 0 || this.pending.length > 0) return
    this.patchDraft({ poll: this.draft.poll ? null : newPoll(this.limits.polls) })
    if (this.draft.poll) void this.focusIn('[data-poll] input[data-option]')
  }

  private patchPoll(patch: Partial<DraftPoll>) {
    const poll = this.draft.poll
    if (poll) this.patchDraft({ poll: { ...poll, ...patch } })
  }

  private setOption(i: number, value: string) {
    const poll = this.draft.poll
    if (poll) this.patchPoll({ options: poll.options.map((o, j) => j === i ? value : o) })
  }

  private addOption = () => {
    const poll = this.draft.poll
    if (!poll || poll.options.length >= this.limits.polls.maxOptions) return
    this.patchPoll({ options: [...poll.options, ''] })
    void this.focusIn(`[data-poll] input[data-option="${poll.options.length}"]`)
  }

  private removeOption(i: number) {
    const poll = this.draft.poll
    if (!poll || poll.options.length <= 2) return
    this.patchPoll({ options: poll.options.filter((_, j) => j !== i) })
    // The option now in its place, or the last one.
    void this.focusIn(`[data-poll] input[data-option="${Math.min(i, poll.options.length - 2)}"]`)
  }

  private async focusIn(selector: string) {
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>(selector)?.focus()
  }

  private renderPoll(poll: DraftPoll, busy: boolean) {
    const limits = this.limits.polls
    const problem = pollProblem(poll, limits)
    // Say what is wrong only once the reader has started on the options,
    // or at once when the server's limits rule the poll out.
    const showProblem = problem !== null && (pollOptions(poll).length > 0 || limitProblem(poll, limits))
    const many = poll.options.length > 2
    return html`<fieldset class="poll" data-poll>
      <legend>Poll</legend>
      <ol>
        ${poll.options.map((o, i) => html`<li>
          <input type="text" data-option=${String(i)} aria-label=${`Option ${i + 1}`}
            placeholder=${`Option ${i + 1}`} maxlength=${limits.maxChars} ?readonly=${busy} .value=${o}
            @input=${(e: Event) => this.setOption(i, (e.target as HTMLInputElement).value)}>
          ${many ? html`<caribou-icon-button icon="x" label=${`Remove option ${i + 1}`} data-action="remove-option"
            ?disabled=${busy} @click=${() => this.removeOption(i)}></caribou-icon-button>` : nothing}
        </li>`)}
      </ol>
      ${poll.options.length < limits.maxOptions
        ? html`<div><caribou-button data-action="add-option" ?disabled=${busy} @click=${this.addOption}>Add option</caribou-button></div>`
        : nothing}
      <div class="settings">
        <label for="compose-poll-duration">Ends in</label>
        <select id="compose-poll-duration" ?disabled=${busy}
          @change=${(e: Event) => this.patchPoll({ expiresIn: Number((e.target as HTMLSelectElement).value) })}>
          ${pollDurations(limits, poll.expiresIn).map((d) => html`<option value=${String(d.seconds)}>${d.label}</option>`)}
        </select>
        <label class="check"><input type="checkbox" data-poll-multiple .checked=${poll.multiple} ?disabled=${busy}
          @change=${(e: Event) => this.patchPoll({ multiple: (e.target as HTMLInputElement).checked })}>Allow several choices</label>
        <label class="check"><input type="checkbox" data-poll-hide-totals .checked=${poll.hideTotals} ?disabled=${busy}
          @change=${(e: Event) => this.patchPoll({ hideTotals: (e.target as HTMLInputElement).checked })}>Hide vote counts until it ends</label>
      </div>
      <p class="note">A post with a poll cannot have media.</p>
      <p class="note problem" data-poll-problem aria-live="polite">${showProblem ? problem : ''}</p>
    </fieldset>`
  }

  // Self-labels for the post's media (spec 7.4), instead of a content
  // warning's text. Each item turns one label on or off.
  private renderLabelMenu(busy: boolean) {
    const labels = this.draft.bluesky?.labels ?? []
    const on = BLUESKY_SELF_LABELS.filter((l) => labels.includes(l.value)).map((l) => l.label)
    return html`<caribou-menu class="labels" icon="triangleAlert" anchored data-action="labels"
        label=${on.length > 0 ? `Label this media: ${on.join(', ')}` : 'Label this media'} ?hidden=${busy}>
      ${BLUESKY_SELF_LABELS.map((l) => html`<button type="button" data-label=${l.value}
        aria-pressed=${labels.includes(l.value) ? 'true' : 'false'}
        @click=${() => this.toggleLabel(l.value)}>${l.label}</button>`)}
    </caribou-menu>
    ${on.length > 0 ? html`<span class="note" data-labels>${on.join(', ')}</span>` : nothing}`
  }

  private removeMedia(id: string) {
    this.patchDraft({ media: this.draft.media.filter((m) => m.id !== id) })
  }

  private removePending(localId: string) {
    const p = this.pending.find((x) => x.localId === localId)
    if (p) URL.revokeObjectURL(p.previewUrl)
    this.pending = this.pending.filter((x) => x.localId !== localId)
  }

  override render() {
    if (!this.ready) return nothing
    const d = this.draft
    const bluesky = this.isBluesky
    const bskyCount = bluesky ? this.bskyCount : null
    const count = bluesky ? bskyCount?.graphemes ?? 0 : this.count
    const overBytes = bskyCount !== null && this.caps.maxBytes !== null && bskyCount.bytes > this.caps.maxBytes
    // Graphemes can be under the limit while bytes are over: say why.
    const byteLimitText = `Over the ${this.caps.maxBytes ?? 0}-byte limit`
    const over = count > this.limits.maxChars || overBytes
    const images = bluesky ? d.bluesky?.images ?? [] : []
    const mediaCount = (bluesky ? images.length : d.media.length) + this.pending.length
    const full = mediaCount >= this.limits.maxMedia
    const editing = this.editing !== null
    const hasPoll = this.activePoll !== null
    const title = editing ? 'Edit post' : this.replyTo || d.inReplyToId ? 'Reply' : this.quoteTo ? 'Quote post' : 'New post'
    const busy = this.posting
    const caps = this.caps
    const submitLabel = editing ? (busy ? 'Saving…' : 'Save')
      : busy ? 'Posting…' : this.replyTo || d.inReplyToId ? 'Reply' : 'Post'
    return html`
      <dialog aria-labelledby="compose-title" @close=${this.onClose}>
        <form @submit=${this.onSubmit} @keydown=${this.onFormKeydown}>
          <header>
            <h2 id="compose-title">${title}</h2>
            <caribou-button data-action="cancel" @click=${() => this.close()}>Cancel</caribou-button>
          </header>
          ${this.replyTo ? html`
            <div class="reply-to" data-reply-to>
              <strong>${this.replyTo.account.displayName || this.replyTo.account.username}</strong>
              <span class="acct">@${this.replyTo.account.acct}</span>
              <div>${plainText(this.replyTo.content)}</div>
            </div>` : nothing}
          ${this.quoteTo ? html`
            <div class="reply-to" data-quote-to>
              <strong>${this.quoteTo.account.displayName || this.quoteTo.account.username}</strong>
              <span class="acct">@${this.quoteTo.account.acct}</span>
              <div>${plainText(this.quoteTo.content)}</div>
            </div>` : nothing}
          ${this.blocked ? html`<p class="note problem" data-compose-blocked role="status">${this.blocked}</p>` : nothing}
          ${this.earlierPosted ? html`<p class="note" data-earlier-posted role="status">Your earlier version was posted.
            <a href=${this.earlierPosted} target="_blank" rel="noopener">Open it</a> (in a new tab). Your edits are still here; Post sends them as a new post.</p>` : nothing}
          ${bluesky && d.bluesky?.sent && !this.earlierPosted && !busy ? html`<p class="note" data-send-unknown>The last send did not finish. Post checks first, so the post is never sent twice.</p>` : nothing}
          ${this.keptRedraft ? html`
            <p class="note" data-redraft-note>Your other unsent draft stays as it is. This redraft is kept on its own and opens first the next time you write a new post.</p>` : nothing}
          ${d.cw && caps.contentWarningText ? html`
            <label class="visually-hidden" for="compose-cw">Content warning</label>
            <input id="compose-cw" type="text" name="spoiler" placeholder="Content warning"
              ?readonly=${busy} .value=${d.spoilerText}
              @input=${(e: Event) => this.patchDraft({ spoilerText: (e.target as HTMLInputElement).value })}>
          ` : nothing}
          <label class="visually-hidden" for="compose-text">Post text</label>
          <textarea id="compose-text" name="status" placeholder="What’s on your mind?"
            ?readonly=${busy} .value=${d.text}
            @input=${(e: Event) => this.patchDraft({ text: (e.target as HTMLTextAreaElement).value })}></textarea>
          ${editing && d.media.length > 0 ? html`
            <ul class="media" aria-label="Attachments" aria-describedby="compose-media-note">
              ${d.media.map((m) => html`
                <li data-media=${m.id}>
                  ${m.type === 'image' || m.type === 'gifv'
                    ? html`<img src=${m.previewUrl ?? m.url} alt=${m.description}>`
                    : html`<div class="file">${m.type}</div>`}
                </li>`)}
            </ul>
            <p class="note" id="compose-media-note">Media stays as it is. Caribou cannot edit attachments yet.</p>`
          : !editing && mediaCount > 0 ? html`
            <ul class="media" aria-label="Attachments">
              ${images.map((img, i) => {
                const id = img.id
                const label = mediaLabel(img.name, 'image', i + 1)
                const preview = this.blobPreviews.get(id)
                return html`
                <li data-bsky-image=${id}>
                  ${preview ? html`<img src=${preview} alt="">` : html`<div class="file">${img.name ?? 'image'}</div>`}
                  ${this.missingBlobs.has(id) ? html`<span class="state" data-state="failed" role="status">Not on the server any more. Remove it and add it again.</span>` : nothing}
                  <input type="text" placeholder="Describe for people who can’t see it"
                    aria-label="Alt text for ${label}" ?readonly=${busy} .value=${img.alt}
                    @input=${(e: Event) => this.patchBluesky({
                      images: (this.draft.bluesky?.images ?? []).map((x) => x.id === id
                        ? { ...x, alt: (e.target as HTMLInputElement).value } : x),
                    })}>
                  <caribou-button data-action="remove-media" ?disabled=${busy} @click=${() => this.removeBlueskyImage(id)}>Remove<span class="visually-hidden"> ${label}</span></caribou-button>
                </li>`
              })}
              ${d.media.map((m, i) => {
                const label = mediaLabel(m.name, m.type, i + 1)
                return html`
                <li data-media=${m.id}>
                  ${m.type === 'image' || m.type === 'gifv'
                    ? html`<img src=${m.previewUrl ?? m.url} alt="">`
                    : html`<div class="file">${m.type}</div>`}
                  <input type="text" placeholder="Describe for people who can’t see it"
                    aria-label="Alt text for ${label}" ?readonly=${busy} .value=${m.description}
                    @input=${(e: Event) => this.patchDraft({
                      media: this.draft.media.map((x) => x.id === m.id
                        ? { ...x, description: (e.target as HTMLInputElement).value } : x),
                    })}
                    @change=${(e: Event) => this.saveAltOrToast(m.id, (e.target as HTMLInputElement).value)}>
                  <caribou-button data-action="remove-media" ?disabled=${busy} @click=${() => this.removeMedia(m.id)}>Remove<span class="visually-hidden"> ${label}</span></caribou-button>
                </li>`
              })}
              ${this.pending.map((p, i) => {
                const label = mediaLabel(p.file.name, p.file.type, (bluesky ? images.length : d.media.length) + i + 1)
                return html`
                <li data-pending=${p.localId}>
                  ${p.file.type.startsWith('image/')
                    ? html`<img src=${p.previewUrl} alt="">`
                    : html`<div class="file">${p.file.name}</div>`}
                  <span class="state" data-state=${p.state} role="status">
                    ${p.state === 'uploading' ? 'Uploading…' : 'Upload failed'}
                  </span>
                  <input type="text" placeholder="Describe for people who can’t see it"
                    aria-label="Alt text for ${label}" .value=${p.description}
                    @input=${(e: Event) => {
                      const description = (e.target as HTMLInputElement).value
                      this.pending = this.pending.map((x) => x.localId === p.localId ? { ...x, description } : x)
                    }}>
                  ${p.state === 'failed'
                    ? html`<caribou-button data-action="retry-media" @click=${() => void (bluesky ? this.uploadBluesky(p.file, p) : this.upload(p.file, p))}>Retry<span class="visually-hidden"> ${label}</span></caribou-button>`
                    : nothing}
                  <caribou-button data-action="remove-media" @click=${() => this.removePending(p.localId)}>Remove<span class="visually-hidden"> ${label}</span></caribou-button>
                </li>`
              })}
            </ul>` : nothing}
          ${this.activePoll ? this.renderPoll(this.activePoll, busy) : nothing}
          <div class="toolbar">
            <!-- The button is the one control Tab reaches; Enter or Space
                 clicks it, and the click opens the hidden file input. -->
            <!-- Icon only, with no text beside it, so a mouse user needs the
                 tooltip even though a reader then hears the name twice. -->
            ${editing ? nothing : html`
            <caribou-icon-button icon="image" label=${bluesky ? 'Add images' : 'Add images or video'} hint=${bluesky ? 'Add images' : 'Add images or video'} data-action="add-media"
              ?disabled=${full || busy} ?soft-disabled=${hasPoll}
              description=${hasPoll ? 'Remove the poll to add media.' : nothing}
              @click=${() => { if (!hasPoll) this.fileEl?.click() }}></caribou-icon-button>
            <input type="file" hidden multiple accept=${bluesky ? 'image/*' : this.limits.accept}
              ?disabled=${full || busy || hasPoll} @change=${this.onFiles}>`}
            ${editing || !caps.polls ? nothing : html`<caribou-icon-button icon="chartColumn" label="Poll" hint="Poll" data-action="toggle-poll"
              pressed=${hasPoll ? 'true' : 'false'} ?disabled=${busy} ?soft-disabled=${mediaCount > 0}
              description=${mediaCount > 0 ? 'Remove the media to add a poll.' : nothing}
              @click=${this.togglePoll}></caribou-icon-button>`}
            ${caps.contentWarningText ? html`<caribou-icon-button icon="triangleAlert" label="Content warning" hint="Content warning" data-action="toggle-cw"
              pressed=${d.cw ? 'true' : 'false'} ?disabled=${busy}
              @click=${() => this.patchDraft({ cw: !d.cw })}></caribou-icon-button>` : nothing}
            ${bluesky && images.length > 0 ? this.renderLabelMenu(busy) : nothing}
            ${caps.visibility ? html`<label class="visually-hidden" for="compose-visibility">Visibility</label>
            <select id="compose-visibility" name="visibility" ?disabled=${busy || editing}
              aria-describedby=${editing ? 'compose-visibility-note' : nothing}
              @change=${(e: Event) => this.patchDraft({ visibility: (e.target as HTMLSelectElement).value as StatusVisibility })}>
              ${VISIBILITIES.map((v) => html`<option value=${v.value}>${v.label}</option>`)}
            </select>` : nothing}
            ${caps.visibility && editing ? html`<span class="note" id="compose-visibility-note">Visibility cannot change.</span>` : nothing}
            <span class="spacer"></span>
            ${overBytes ? html`<span class="note problem" data-byte-limit>${byteLimitText}</span>` : nothing}
            <span class="count" ?data-over=${over}
              aria-label=${`${this.limits.maxChars - count} characters left${overBytes ? `, ${byteLimitText.toLowerCase()}` : ''}`}>${this.limits.maxChars - count}</span>
            <!-- Announces only when the limit is crossed, not every keystroke. -->
            <span class="visually-hidden" aria-live="polite" data-limit-status>${overBytes ? byteLimitText : over ? 'Over the character limit' : ''}</span>
            <caribou-button variant="primary" type="submit" class="post" data-action="post"
              ?disabled=${!this.canPost && !busy} ?loading=${busy}>
              ${submitLabel}
            </caribou-button>
          </div>
        </form>
      </dialog>
    `
  }
}

// Focus may sit inside a shadow root; return to the element itself.
function deepActive(el: HTMLElement): HTMLElement {
  let cur: HTMLElement = el
  while (cur.shadowRoot?.activeElement instanceof HTMLElement) cur = cur.shadowRoot.activeElement
  return cur
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-compose-dialog': CaribouComposeDialog }
}
