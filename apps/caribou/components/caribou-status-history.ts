import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import DOMPurify from 'dompurify'
import type { mastodon } from 'masto'
import { effect } from '@preact/signals-core'
import { PURIFY_OPTS, installPurifyHooks } from '@beatzball/caribou-mastodon-client/sanitize-opts'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeUserKey, ownerGeneration } from '@beatzball/caribou-state'
import { boxReset, mastodonLinkText } from './_shared-styles.js'
import './caribou-button.js'

// Client only: the dialog opens from a click. The same hooks as the post
// card, so a version reads the same as the post.
if (typeof window !== 'undefined') installPurifyHooks(DOMPurify)

type Edit = mastodon.v1.StatusEdit

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// The versions of a post, newest first, in a modal dialog. Each version's
// HTML goes through DOMPurify with the post card's options.
@customElement('caribou-status-history')
export class CaribouStatusHistory extends LitElement {
  static override styles = [boxReset, mastodonLinkText, css`
    dialog {
      inline-size: min(36rem, calc(100vw - 2 * var(--space-4)));
      max-block-size: calc(100dvh - 2 * var(--space-4));
      padding: 0; color: var(--fg-0); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    header {
      display: flex; justify-content: space-between; align-items: center; gap: var(--space-2);
      padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border);
    }
    h2 { margin: 0; font-size: 1.125rem; }
    .body { padding: var(--space-2) var(--space-4) var(--space-4); }
    ol { margin: 0; padding: 0; list-style: none; }
    li { padding: var(--space-3) 0; border-bottom: 1px solid var(--border); }
    li:last-child { border-bottom: 0; }
    .meta { color: var(--fg-muted); font-size: 0.875rem; }
    .spoiler { margin: var(--space-2) 0 0; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
    .content { margin-top: var(--space-2); overflow-wrap: anywhere; }
    .content p { margin: 0 0 var(--space-2); }
    .media { margin: var(--space-2) 0 0; color: var(--fg-muted); font-size: 0.875rem; }
    .status { color: var(--fg-1); }
  `]

  @state() versions: Edit[] | null = null
  @state() failed = false

  private resolve: (() => void) | null = null
  private closed = false

  /** Opens the dialog; resolves when it closes. */
  async open(): Promise<void> {
    await this.updateComplete
    if (this.closed) return
    const dialog = this.renderRoot.querySelector('dialog')!
    return new Promise((resolve) => {
      this.resolve = resolve
      dialog.showModal()
      this.renderRoot.querySelector<HTMLElement>('caribou-button.close')?.focus()
    })
  }

  /** Closes the dialog, even before it opened. */
  close() {
    this.closed = true
    this.renderRoot.querySelector('dialog')?.close()
    this.finish()
  }

  private finish = () => {
    const resolve = this.resolve
    this.resolve = null
    resolve?.()
  }

  private renderVersion(v: Edit, i: number, all: Edit[]) {
    const label = i === 0 ? 'Current version' : i === all.length - 1 ? 'Original' : 'Edited'
    const media = v.mediaAttachments?.length ?? 0
    return html`<li data-version=${i}>
      <div class="meta"><strong>${label}</strong> · <time datetime=${v.createdAt}>${when(v.createdAt)}</time></div>
      ${v.spoilerText ? html`<p class="spoiler">${v.spoilerText}</p>` : nothing}
      <div class="content">${unsafeHTML(DOMPurify.sanitize(v.content ?? '', PURIFY_OPTS))}</div>
      ${media > 0 ? html`<p class="media">${plural(media, 'attachment', 'attachments')}</p>` : nothing}
    </li>`
  }

  override render() {
    const vs = this.versions
    return html`<dialog aria-labelledby="h" @close=${this.finish}>
      <header>
        <h2 id="h">Edit history</h2>
        <caribou-button class="close" variant="secondary" @click=${() => this.close()}>Close</caribou-button>
      </header>
      <div class="body">
        ${this.failed
          ? html`<p class="status" role="alert">Could not load the edit history.</p>`
          : vs === null
          ? html`<p class="status" role="status">Loading…</p>`
          : html`<ol aria-label="Versions, newest first">${vs.map((v, i) => this.renderVersion(v, i, vs))}</ol>`}
      </div>
    </dialog>`
  }
}

/**
 * Shows a post's edit history. The history belongs to the account that
 * asked: an answer that lands after the account changed is dropped, and the
 * dialog closes on the change. Client only.
 */
export async function showStatusHistory(client: CaribouClient, statusId: string): Promise<void> {
  const el = document.createElement('caribou-status-history') as CaribouStatusHistory
  document.body.appendChild(el)
  const owner = activeUserKey.peek()
  const generation = ownerGeneration()
  const stop = effect(() => { if (activeUserKey.value !== owner) el.close() })
  const opened = el.open()
  client.fetchStatusHistory(statusId).then((list) => {
    if (generation !== ownerGeneration() || !el.isConnected) return
    // Mastodon sends the oldest first.
    el.versions = [...list].reverse()
  }, () => {
    if (generation === ownerGeneration()) el.failed = true
  })
  try {
    await opened
  } finally {
    stop()
    el.remove()
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-status-history': CaribouStatusHistory }
}
