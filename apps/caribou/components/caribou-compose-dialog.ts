import { LitElement, html, css, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, activeUser, activeUserKey, userName, editOwnStatus, findRedraftSlot, isDraftEmpty, newestKnownStatus, olderEdit,
  draftSlot, emptyDraft, loadDraft, postDraft, saveDraft,
  pollOptions,
  type ComposeDraft, type DraftMedia, type DraftPoll, type DraftSlot, type UserSession,
} from '@beatzball/caribou-state'
import { MediaProcessingTimeout, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'
import './caribou-icon-button.js'
import { countChars, plainText, replyMentions, replyVisibility } from './_compose-text.js'
import { draftMediaOf, POLL_EDIT_REFUSED } from './_redraft.js'

/**
 * What `caribou:compose` asks for: a new post, a reply to `inReplyTo`, an
 * edit of the reader's own post (`edit`, with its source text), or a new
 * post filled from a deleted one (`redraft`, with `inReplyTo` when the
 * page has the post it replied to).
 */
export interface ComposeDetail {
  inReplyTo?: mastodon.v1.Status
  edit?: { status: mastodon.v1.Status; source: mastodon.v1.StatusSource }
  redraft?: ComposeDraft
}

interface PollLimits { maxOptions: number; maxChars: number; minExpiration: number; maxExpiration: number }

interface Limits { maxChars: number; maxMedia: number; accept: string; polls: PollLimits }

// Mastodon's own defaults, for a server that does not say.
const DEFAULT_POLL_LIMITS: PollLimits = { maxOptions: 4, maxChars: 50, minExpiration: 300, maxExpiration: 2_629_746 }

const DEFAULT_LIMITS: Limits = { maxChars: 500, maxMedia: 4, accept: 'image/*,video/*,audio/*', polls: DEFAULT_POLL_LIMITS }

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

/** The durations the server allows. A stored one outside the list is kept. */
function pollDurations(limits: PollLimits, current: number | null): { seconds: number; label: string }[] {
  const allowed = POLL_DURATIONS.filter((d) => d.seconds >= limits.minExpiration && d.seconds <= limits.maxExpiration)
  if (current !== null && !allowed.some((d) => d.seconds === current)) {
    allowed.push({ seconds: current, label: `${Math.round(current / 60)} minutes` })
    allowed.sort((a, b) => a.seconds - b.seconds)
  }
  return allowed
}

function newPoll(limits: PollLimits): DraftPoll {
  const expiresIn = Math.min(Math.max(DAY, limits.minExpiration), limits.maxExpiration)
  return { options: ['', ''], expiresIn, multiple: false, hideTotals: false }
}

/** Why a poll cannot be posted yet, or null. */
function pollProblem(poll: DraftPoll): string | null {
  const filled = poll.options.map((o) => o.trim())
  if (filled.some((o) => o === '')) return 'Every option needs text.'
  const seen = new Set(filled.map((o) => o.toLocaleLowerCase()))
  if (seen.size < filled.length) return 'Two options are the same.'
  return null
}

// One fetch per server for the page's lifetime; the limits rarely change.
const limitsByServer = new Map<string, Promise<Limits>>()

function fetchLimits(client: CaribouClient, server: string): Promise<Limits> {
  let p = limitsByServer.get(server)
  if (!p) {
    p = client.fetchInstance().then((i) => ({
      maxChars: i.configuration?.statuses?.maxCharacters ?? DEFAULT_LIMITS.maxChars,
      maxMedia: i.configuration?.statuses?.maxMediaAttachments ?? DEFAULT_LIMITS.maxMedia,
      accept: i.configuration?.mediaAttachments?.supportedMimeTypes?.join(',') || DEFAULT_LIMITS.accept,
      polls: {
        maxOptions: i.configuration?.polls?.maxOptions ?? DEFAULT_POLL_LIMITS.maxOptions,
        maxChars: i.configuration?.polls?.maxCharactersPerOption ?? DEFAULT_POLL_LIMITS.maxChars,
        minExpiration: i.configuration?.polls?.minExpiration ?? DEFAULT_POLL_LIMITS.minExpiration,
        maxExpiration: i.configuration?.polls?.maxExpiration ?? DEFAULT_POLL_LIMITS.maxExpiration,
      },
    })).catch(() => {
      limitsByServer.delete(server)
      return DEFAULT_LIMITS
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
function defaultVisibility(user: UserSession): mastodon.v1.StatusVisibility {
  const privacy = (user.account as Partial<mastodon.v1.AccountCredentials> | null)?.source?.privacy
  return privacy && ['public', 'unlisted', 'private', 'direct'].includes(privacy) ? privacy : 'public'
}

const VISIBILITIES: { value: mastodon.v1.StatusVisibility; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Followers only' },
  { value: 'direct', label: 'Mentioned people only' },
]

function toast(kind: 'error' | 'info', message: string): void {
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail: { kind, message } }))
}

function isTextField(el: EventTarget | undefined): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
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
    .poll .problem { color: var(--danger); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `]

  // Nothing is rendered until the first open: the server has no session,
  // so its render and the first client render are both empty, and a page
  // where nobody composes never builds the form.
  @state() private ready = false
  private open = false
  @state() private draft: ComposeDraft = emptyDraft()
  @state() private replyTo: mastodon.v1.Status | null = null
  // The reader's own post being edited. An edit is not kept as a draft,
  // keeps the post's visibility (Mastodon cannot change it) and its media.
  @state() private editing: mastodon.v1.Status | null = null
  @state() private pending: PendingMedia[] = []
  @state() private posting = false
  // Counts openings, so a post that finishes after its dialog closed knows
  // it no longer owns the dialog.
  private session = 0
  @state() private limits: Limits = DEFAULT_LIMITS

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
    window.addEventListener('keydown', this.onKeydown)
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
    window.removeEventListener('keydown', this.onKeydown)
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
    else this.show(detail?.inReplyTo ?? null)
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (!this.isActive() || this.open) return
    if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    if (isTextField(e.composedPath()[0])) return
    if (!activeClient.value) return
    e.preventDefault()
    this.show(null)
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
    this.session += 1
    this.posting = false
    this.syncedAlt = new Map()
    this.altSaves = new Map()
    this.replyTo = null
    this.editing = null
    this.pending = []
    return true
  }

  private finishOpen() {
    this.open = true
    this.showPending = true
    this.ready = true
    const client = this.client
    const user = activeUser.value
    if (client && user) void fetchLimits(client, user.server).then((l) => { this.limits = l })
  }

  /**
   * Opens the dialog on the reader's own post, filled with its source text.
   * Saving replaces the post's text and content warning; visibility and
   * media stay as they are.
   */
  showEdit(status: mastodon.v1.Status, source: mastodon.v1.StatusSource): void {
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
  showRedraft(draft: ComposeDraft, inReplyTo: mastodon.v1.Status | null = null): void {
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
  show(inReplyTo: mastodon.v1.Status | null): void {
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

  private get count(): number {
    return countChars(this.draft.text, this.draft.cw ? this.draft.spoilerText : '')
  }

  // A poll needs text with it: Mastodon refuses a post with only a poll.
  private get canPost(): boolean {
    const poll = this.activePoll
    const hasContent = this.draft.text.trim() !== '' || (this.draft.media.length > 0 && !poll)
    if (poll && pollProblem(poll) !== null) return false
    return hasContent && this.count <= this.limits.maxChars
      && this.pending.length === 0 && !this.posting
  }

  // Saves an edit. A failure leaves the post as it was and the dialog open
  // with the reader's text, so nothing is lost.
  //
  // Media, language and the poll come from the newest copy of the post this
  // page knows, which may be newer than the one the dialog opened with: an
  // edit replaces the media list, so an older one would drop new media.
  private async saveEdit(client: CaribouClient, opened: mastodon.v1.Status) {
    const known = newestKnownStatus(opened.id)
    const post = known && olderEdit(opened, known) ? known : opened
    if (post.poll) {
      toast('error', POLL_EDIT_REFUSED)
      return
    }
    const session = this.session
    const d = this.draft
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
    if (!client || !this.canPost) return
    if (activeUserKey.value !== client.userKey) return
    if (this.editing) return this.saveEdit(client, this.editing)
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
      await postDraft(client, this.draftKey, this.draft)
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
    const room = this.limits.maxMedia - this.draft.media.length - this.pending.length
    const files = [...(input.files ?? [])]
    input.value = ''
    if (files.length > room) toast('error', `You can attach up to ${this.limits.maxMedia} files.`)
    for (const file of files.slice(0, Math.max(0, room))) void this.upload(file)
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
    return !this.editing && this.draft.poll && this.draft.media.length === 0 ? this.draft.poll : null
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
    const problem = pollProblem(poll)
    // Say what is wrong only once the reader has started on the options.
    const showProblem = problem !== null && pollOptions(poll).length > 0
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
    const count = this.count
    const over = count > this.limits.maxChars
    const mediaCount = d.media.length + this.pending.length
    const full = mediaCount >= this.limits.maxMedia
    const editing = this.editing !== null
    const hasPoll = this.activePoll !== null
    const title = editing ? 'Edit post' : this.replyTo || d.inReplyToId ? 'Reply' : 'New post'
    const busy = this.posting
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
          ${this.keptRedraft ? html`
            <p class="note" data-redraft-note>Your other unsent draft stays as it is. This redraft is kept on its own and opens first the next time you write a new post.</p>` : nothing}
          ${d.cw ? html`
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
                const label = mediaLabel(p.file.name, p.file.type, d.media.length + i + 1)
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
                    ? html`<caribou-button data-action="retry-media" @click=${() => void this.upload(p.file, p)}>Retry<span class="visually-hidden"> ${label}</span></caribou-button>`
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
            <caribou-icon-button icon="image" label="Add images or video" hint="Add images or video" data-action="add-media"
              ?disabled=${full || busy} ?soft-disabled=${hasPoll}
              description=${hasPoll ? 'Remove the poll to add media.' : nothing}
              @click=${() => { if (!hasPoll) this.fileEl?.click() }}></caribou-icon-button>
            <input type="file" hidden multiple accept=${this.limits.accept}
              ?disabled=${full || busy || hasPoll} @change=${this.onFiles}>
            <caribou-icon-button icon="chartColumn" label="Poll" hint="Poll" data-action="toggle-poll"
              pressed=${hasPoll ? 'true' : 'false'} ?disabled=${busy} ?soft-disabled=${mediaCount > 0}
              description=${mediaCount > 0 ? 'Remove the media to add a poll.' : nothing}
              @click=${this.togglePoll}></caribou-icon-button>`}
            <caribou-icon-button icon="triangleAlert" label="Content warning" hint="Content warning" data-action="toggle-cw"
              pressed=${d.cw ? 'true' : 'false'} ?disabled=${busy}
              @click=${() => this.patchDraft({ cw: !d.cw })}></caribou-icon-button>
            <label class="visually-hidden" for="compose-visibility">Visibility</label>
            <select id="compose-visibility" name="visibility" ?disabled=${busy || editing}
              aria-describedby=${editing ? 'compose-visibility-note' : nothing}
              @change=${(e: Event) => this.patchDraft({ visibility: (e.target as HTMLSelectElement).value as mastodon.v1.StatusVisibility })}>
              ${VISIBILITIES.map((v) => html`<option value=${v.value}>${v.label}</option>`)}
            </select>
            ${editing ? html`<span class="note" id="compose-visibility-note">Visibility cannot change.</span>` : nothing}
            <span class="spacer"></span>
            <span class="count" ?data-over=${over}
              aria-label=${`${this.limits.maxChars - count} characters left`}>${this.limits.maxChars - count}</span>
            <!-- Announces only when the limit is crossed, not every keystroke. -->
            <span class="visually-hidden" aria-live="polite" data-limit-status>${over ? 'Over the character limit' : ''}</span>
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
