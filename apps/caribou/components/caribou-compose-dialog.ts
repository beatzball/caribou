import { LitElement, html, css, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, activeUser, activeUserKey, userName,
  draftSlot, emptyDraft, loadDraft, postDraft, saveDraft,
  type ComposeDraft, type DraftMedia, type DraftSlot, type UserSession,
} from '@beatzball/caribou-state'
import { MediaProcessingTimeout, type CaribouClient } from '@beatzball/caribou-mastodon-client'
import { boxReset } from './_shared-styles.js'
import { ICONS } from './_icons.js'
import { countChars, plainText, replyMentions, replyVisibility } from './_compose-text.js'

export interface ComposeDetail { inReplyTo?: mastodon.v1.Status }

interface Limits { maxChars: number; maxMedia: number; accept: string }

const DEFAULT_LIMITS: Limits = { maxChars: 500, maxMedia: 4, accept: 'image/*,video/*,audio/*' }

// One fetch per server for the page's lifetime; the limits rarely change.
const limitsByServer = new Map<string, Promise<Limits>>()

function fetchLimits(client: CaribouClient, server: string): Promise<Limits> {
  let p = limitsByServer.get(server)
  if (!p) {
    p = client.fetchInstance().then((i) => ({
      maxChars: i.configuration?.statuses?.maxCharacters ?? DEFAULT_LIMITS.maxChars,
      maxMedia: i.configuration?.statuses?.maxMediaAttachments ?? DEFAULT_LIMITS.maxMedia,
      accept: i.configuration?.mediaAttachments?.supportedMimeTypes?.join(',') || DEFAULT_LIMITS.accept,
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
      max-height: calc(100vh - 2 * var(--space-4));
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
    .count { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
    .count[data-over] { color: var(--danger); }
    button, .pick {
      font: inherit; cursor: pointer; border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3); border: 1px solid var(--border);
      background: var(--bg-1); color: var(--fg-0);
    }
    .toolbar button, .toolbar select, .pick { min-block-size: 2.25rem; }
    .icon {
      display: inline-flex; align-items: center; justify-content: center;
      min-inline-size: 2.25rem; padding: 0; font-size: 1.25em;
    }
    @media (pointer: coarse) {
      .toolbar button, .toolbar select, .pick { min-block-size: 44px; }
      .icon { min-inline-size: 44px; }
    }
    button:focus-visible, .pick:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
    button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
    /* An accent ring on an accent fill would not show. */
    button[aria-pressed="true"]:focus-visible { outline-color: var(--fg-0); }
    button.post { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pick[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `]

  // Nothing is rendered until the first open: the server has no session,
  // so its render and the first client render are both empty, and a page
  // where nobody composes never builds the form.
  @state() private ready = false
  private open = false
  @state() private draft: ComposeDraft = emptyDraft()
  @state() private replyTo: mastodon.v1.Status | null = null
  @state() private pending: PendingMedia[] = []
  @state() private posting = false
  // Counts openings, so a post that finishes after its dialog closed knows
  // it no longer owns the dialog.
  private session = 0
  @state() private limits: Limits = DEFAULT_LIMITS

  @query('dialog') private dialogEl?: HTMLDialogElement
  @query('textarea') private textareaEl?: HTMLTextAreaElement
  @query('select') private selectEl?: HTMLSelectElement

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
        this.close()
        toast('info', 'Your draft is saved for the account you started it with.')
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
    this.show(detail?.inReplyTo ?? null)
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (!this.isActive() || this.open) return
    if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    if (isTextField(e.composedPath()[0])) return
    if (!activeClient.value) return
    e.preventDefault()
    this.show(null)
  }

  /** Opens the dialog for a new post, or a reply to `inReplyTo`. */
  show(inReplyTo: mastodon.v1.Status | null): void {
    const client = activeClient.value
    const user = activeUser.value
    if (!client || !user || this.open) return

    const active = document.activeElement
    this.returnFocus = active instanceof HTMLElement ? deepActive(active) : null

    this.client = client
    this.session += 1
    this.posting = false
    this.syncedAlt = new Map()
    this.altSaves = new Map()
    this.draftKey = draftSlot(inReplyTo?.id)
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
    this.pending = []
    this.open = true
    this.showPending = true
    this.ready = true
    void fetchLimits(client, user.server).then((l) => { this.limits = l })
  }

  private close() {
    this.dialogEl?.close()
  }

  // Runs for Esc, the Cancel button and a successful post alike. The draft
  // is already stored, so closing loses nothing.
  private onClose = () => {
    this.open = false
    this.client = null
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
    saveDraft(this.client.userKey, this.draftKey, this.draft)
  }

  private get count(): number {
    return countChars(this.draft.text, this.draft.cw ? this.draft.spoilerText : '')
  }

  private get canPost(): boolean {
    const hasContent = this.draft.text.trim() !== '' || this.draft.media.length > 0
    return hasContent && this.count <= this.limits.maxChars
      && this.pending.length === 0 && !this.posting
  }

  private async submit() {
    const client = this.client
    if (!client || !this.canPost) return
    if (activeUserKey.value !== client.userKey) return
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
        description: current.description,
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
    const title = this.replyTo ? 'Reply' : 'New post'
    const busy = this.posting
    return html`
      <dialog aria-labelledby="compose-title" @close=${this.onClose}>
        <form @submit=${this.onSubmit} @keydown=${this.onFormKeydown}>
          <header>
            <h2 id="compose-title">${title}</h2>
            <button type="button" data-action="cancel" @click=${() => this.close()}>Cancel</button>
          </header>
          ${this.replyTo ? html`
            <div class="reply-to" data-reply-to>
              <strong>${this.replyTo.account.displayName || this.replyTo.account.username}</strong>
              <span class="acct">@${this.replyTo.account.acct}</span>
              <div>${plainText(this.replyTo.content)}</div>
            </div>` : nothing}
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
          ${mediaCount > 0 ? html`
            <ul class="media" aria-label="Attachments">
              ${d.media.map((m) => html`
                <li data-media=${m.id}>
                  ${m.type === 'image' || m.type === 'gifv'
                    ? html`<img src=${m.previewUrl ?? m.url} alt="">`
                    : html`<div class="file">${m.type}</div>`}
                  <input type="text" placeholder="Describe for people who can’t see it"
                    aria-label="Alt text" ?readonly=${busy} .value=${m.description}
                    @input=${(e: Event) => this.patchDraft({
                      media: this.draft.media.map((x) => x.id === m.id
                        ? { ...x, description: (e.target as HTMLInputElement).value } : x),
                    })}
                    @change=${(e: Event) => this.saveAltOrToast(m.id, (e.target as HTMLInputElement).value)}>
                  <button type="button" data-action="remove-media" ?disabled=${busy} @click=${() => this.removeMedia(m.id)}>Remove</button>
                </li>`)}
              ${this.pending.map((p) => html`
                <li data-pending=${p.localId}>
                  ${p.file.type.startsWith('image/')
                    ? html`<img src=${p.previewUrl} alt="">`
                    : html`<div class="file">${p.file.name}</div>`}
                  <span class="state" data-state=${p.state} role="status">
                    ${p.state === 'uploading' ? 'Uploading…' : 'Upload failed'}
                  </span>
                  <input type="text" placeholder="Describe for people who can’t see it"
                    aria-label="Alt text" .value=${p.description}
                    @input=${(e: Event) => {
                      const description = (e.target as HTMLInputElement).value
                      this.pending = this.pending.map((x) => x.localId === p.localId ? { ...x, description } : x)
                    }}>
                  ${p.state === 'failed'
                    ? html`<button type="button" data-action="retry-media" @click=${() => void this.upload(p.file, p)}>Retry</button>`
                    : nothing}
                  <button type="button" data-action="remove-media" @click=${() => this.removePending(p.localId)}>Remove</button>
                </li>`)}
            </ul>` : nothing}
          <div class="toolbar">
            <!-- The real file input stays inside the label, not behind a
                 button, so Tab reaches it and Enter or Space opens the picker. -->
            <label class="pick icon" title="Add images or video" aria-disabled=${full || busy ? 'true' : 'false'}>
              ${ICONS.image}
              <input class="visually-hidden" type="file" multiple accept=${this.limits.accept}
                aria-label="Add images or video" ?disabled=${full || busy} @change=${this.onFiles}>
            </label>
            <button type="button" class="icon" data-action="toggle-cw" aria-label="Content warning" title="Content warning"
              aria-pressed=${d.cw ? 'true' : 'false'} ?disabled=${busy}
              @click=${() => this.patchDraft({ cw: !d.cw })}>${ICONS.triangleAlert}</button>
            <label class="visually-hidden" for="compose-visibility">Visibility</label>
            <select id="compose-visibility" name="visibility" ?disabled=${busy}
              @change=${(e: Event) => this.patchDraft({ visibility: (e.target as HTMLSelectElement).value as mastodon.v1.StatusVisibility })}>
              ${VISIBILITIES.map((v) => html`<option value=${v.value}>${v.label}</option>`)}
            </select>
            <span class="spacer"></span>
            <span class="count" ?data-over=${over}
              aria-label=${`${this.limits.maxChars - count} characters left`}>${this.limits.maxChars - count}</span>
            <!-- Announces only when the limit is crossed, not every keystroke. -->
            <span class="visually-hidden" aria-live="polite" data-limit-status>${over ? 'Over the character limit' : ''}</span>
            <button type="submit" class="post" ?disabled=${!this.canPost}>
              ${this.posting ? 'Posting…' : this.replyTo ? 'Reply' : 'Post'}
            </button>
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
