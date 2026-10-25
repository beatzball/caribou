import { LitElement, html, css, nothing } from 'lit'
import { customElement, query, state } from 'lit/decorators.js'
import type { mastodon } from 'masto'
import {
  activeClient, activeUser,
  draftSlot, emptyDraft, loadDraft, postDraft, saveDraft,
  type ComposeDraft, type DraftMedia, type DraftSlot,
} from '@beatzball/caribou-state'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { boxReset } from './_shared-styles.js'
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
interface PendingMedia {
  localId: string
  file: File
  previewUrl: string
  description: string
  state: 'uploading' | 'failed'
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
    button[aria-pressed="true"] { background: var(--bg-2); }
    button.post { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .pick[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `]

  // The server renders nothing; the dialog appears after the first client
  // update so both renders stay equal.
  @state() private ready = false
  @state() private open = false
  @state() private draft: ComposeDraft = emptyDraft()
  @state() private replyTo: mastodon.v1.Status | null = null
  @state() private pending: PendingMedia[] = []
  @state() private posting = false
  @state() private limits: Limits = DEFAULT_LIMITS

  @query('dialog') private dialogEl?: HTMLDialogElement
  @query('textarea') private textareaEl?: HTMLTextAreaElement

  private draftKey: DraftSlot = 'new'
  private returnFocus: HTMLElement | null = null

  override connectedCallback() {
    super.connectedCallback()
    mounted.push(this)
    window.addEventListener('caribou:compose', this.onCompose)
    window.addEventListener('keydown', this.onKeydown)
  }

  override disconnectedCallback() {
    const i = mounted.indexOf(this)
    if (i >= 0) mounted.splice(i, 1)
    window.removeEventListener('caribou:compose', this.onCompose)
    window.removeEventListener('keydown', this.onKeydown)
    for (const p of this.pending) URL.revokeObjectURL(p.previewUrl)
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.ready = true
  }

  protected override updated() {
    if (this.open && this.dialogEl && !this.dialogEl.open) {
      this.dialogEl.showModal()
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

    this.draftKey = draftSlot(inReplyTo?.id)
    this.replyTo = inReplyTo
    this.draft = loadDraft(client.userKey, this.draftKey) ?? (inReplyTo
      ? emptyDraft({
        text: replyMentions(inReplyTo, user.account.acct),
        visibility: replyVisibility(inReplyTo.visibility, 'public'),
        inReplyToId: inReplyTo.id,
        cw: inReplyTo.spoilerText !== '',
        spoilerText: inReplyTo.spoilerText,
      })
      : emptyDraft())
    this.pending = []
    this.open = true
    void fetchLimits(client, user.server).then((l) => { this.limits = l })
  }

  private close() {
    this.dialogEl?.close()
  }

  // Runs for Esc, the Cancel button and a successful post alike. The draft
  // is already stored, so closing loses nothing.
  private onClose = () => {
    this.open = false
    for (const p of this.pending) URL.revokeObjectURL(p.previewUrl)
    this.pending = []
    const target = this.returnFocus
    this.returnFocus = null
    if (target?.isConnected) target.focus()
  }

  private patchDraft(patch: Partial<ComposeDraft>) {
    this.draft = { ...this.draft, ...patch }
    const client = activeClient.value
    if (client) saveDraft(client.userKey, this.draftKey, this.draft)
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
    const client = activeClient.value
    if (!client || !this.canPost) return
    this.posting = true
    try {
      await postDraft(client, this.draftKey, this.draft)
      this.draft = emptyDraft()
      this.close()
      toast('info', this.replyTo ? 'Reply posted' : 'Post published')
    } catch (err) {
      toast('error', `Could not post: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.posting = false
    }
  }

  private onSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    void this.submit()
  }

  private onFormKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void this.submit()
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
    const client = activeClient.value
    if (!client) return
    const item: PendingMedia = retry
      ? { ...retry, state: 'uploading' }
      : { localId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), description: '', state: 'uploading' }
    this.pending = retry
      ? this.pending.map((p) => p.localId === item.localId ? item : p)
      : [...this.pending, item]
    try {
      const m = await client.uploadMedia(file, item.description ? { description: item.description } : {})
      // The item may have been removed, or the dialog closed, meanwhile.
      const current = this.pending.find((p) => p.localId === item.localId)
      if (!current) return
      this.pending = this.pending.filter((p) => p !== current)
      URL.revokeObjectURL(current.previewUrl)
      const media: DraftMedia = {
        id: m.id, type: m.type, url: m.url ?? '', previewUrl: m.previewUrl ?? null,
        description: current.description,
      }
      this.patchDraft({ media: [...this.draft.media, media] })
      // Alt text typed while the file was uploading.
      if (current.description && current.description !== (m.description ?? '')) {
        void this.saveDescription(media.id, current.description)
      }
    } catch (err) {
      this.pending = this.pending.map((p) => p.localId === item.localId ? { ...p, state: 'failed' } : p)
      toast('error', `Upload failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async saveDescription(id: string, description: string) {
    try {
      await activeClient.value?.updateMedia(id, { description })
    } catch (err) {
      toast('error', `Could not save the description: ${err instanceof Error ? err.message : String(err)}`)
    }
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
              .value=${d.spoilerText}
              @input=${(e: Event) => this.patchDraft({ spoilerText: (e.target as HTMLInputElement).value })}>
          ` : nothing}
          <label class="visually-hidden" for="compose-text">Post text</label>
          <textarea id="compose-text" name="status" placeholder="What’s on your mind?"
            .value=${d.text}
            @input=${(e: Event) => this.patchDraft({ text: (e.target as HTMLTextAreaElement).value })}></textarea>
          ${mediaCount > 0 ? html`
            <ul class="media" aria-label="Attachments">
              ${d.media.map((m) => html`
                <li data-media=${m.id}>
                  ${m.type === 'image' || m.type === 'gifv'
                    ? html`<img src=${m.previewUrl ?? m.url} alt="">`
                    : html`<div class="file">${m.type}</div>`}
                  <input type="text" placeholder="Describe for people who can’t see it"
                    aria-label="Alt text" .value=${m.description}
                    @input=${(e: Event) => this.patchDraft({
                      media: this.draft.media.map((x) => x.id === m.id
                        ? { ...x, description: (e.target as HTMLInputElement).value } : x),
                    })}
                    @change=${(e: Event) => void this.saveDescription(m.id, (e.target as HTMLInputElement).value)}>
                  <button type="button" data-action="remove-media" @click=${() => this.removeMedia(m.id)}>Remove</button>
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
            <label class="pick" aria-disabled=${full ? 'true' : 'false'}>
              Add media
              <input class="visually-hidden" type="file" multiple accept=${this.limits.accept}
                ?disabled=${full} @change=${this.onFiles}>
            </label>
            <button type="button" data-action="toggle-cw" aria-pressed=${d.cw ? 'true' : 'false'}
              @click=${() => this.patchDraft({ cw: !d.cw })}>CW</button>
            <label class="visually-hidden" for="compose-visibility">Visibility</label>
            <select id="compose-visibility" name="visibility"
              @change=${(e: Event) => this.patchDraft({ visibility: (e.target as HTMLSelectElement).value as mastodon.v1.StatusVisibility })}>
              ${VISIBILITIES.map((v) => html`<option value=${v.value} ?selected=${v.value === d.visibility}>${v.label}</option>`)}
            </select>
            <span class="spacer"></span>
            <span class="count" ?data-over=${over} aria-live="polite"
              aria-label=${`${this.limits.maxChars - count} characters left`}>${this.limits.maxChars - count}</span>
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
