import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import type { mastodon } from 'masto'
import { boxReset } from './_shared-styles.js'
import { httpUrl } from './_http-url.js'

type Media = mastodon.v1.MediaAttachment

// Mastodon shows at most four attachments on a post.
const MAX_ITEMS = 4

// Width over height from the preview's size, then the original's. A box
// sized from it holds its place before the file arrives.
export function aspectOf(m: Media): number {
  for (const size of [m.meta?.small, m.meta?.original]) {
    if (!size) continue
    const ratio = size.aspect || (size.height ? size.width / size.height : 0)
    if (Number.isFinite(ratio) && ratio > 0) return ratio
  }
  return 16 / 9
}

// The full file. A remote post's `url` is null until the home instance has
// copied the file; `remoteUrl` is the original then.
function fullUrl(m: Media): string | undefined {
  return httpUrl(m.url) ?? httpUrl(m.remoteUrl)
}

@customElement('caribou-status-media')
export class CaribouStatusMedia extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; margin-top: var(--space-3); }
    .media { position: relative; }
    .grid {
      display: grid; gap: var(--space-1);
      border-radius: var(--radius-md); overflow: hidden;
    }
    /* One item keeps its own shape, up to a cap for very tall images. */
    .grid[data-count="1"] .item { aspect-ratio: var(--ar); max-height: 32rem; }
    /* Two to four share one 16:9 box, so every post with media in a grid is
       the same height. Three: the first item is a column of its own. */
    .grid:not([data-count="1"]) {
      aspect-ratio: 16 / 9;
      grid-template-columns: 1fr 1fr;
    }
    .grid[data-count="3"], .grid[data-count="4"] { grid-template-rows: 1fr 1fr; }
    .grid[data-count="3"] .item:first-child { grid-row: span 2; }
    .item {
      position: relative; min-width: 0; min-height: 0; width: 100%;
      background: var(--bg-2);
      display: flex; align-items: center; justify-content: center;
    }
    .thumb { display: block; width: 100%; height: 100%; }
    img, video { display: block; width: 100%; height: 100%; object-fit: cover; }
    .grid[data-count="1"] img, .grid[data-count="1"] video { object-fit: contain; }
    audio { width: 100%; padding: var(--space-2); }
    .file { padding: var(--space-3); color: var(--accent); overflow-wrap: anywhere; }
    a:focus-visible, button:focus-visible {
      outline: 2px solid var(--accent); outline-offset: -2px;
    }
    button {
      font: inherit; cursor: pointer; border: 0;
      border-radius: var(--radius-sm);
    }
    .alt {
      position: absolute; inset-block-end: var(--space-2); inset-inline-start: var(--space-2);
      padding: 0 var(--space-2); font-size: 0.75rem; font-weight: 700;
      color: #fff; background: rgb(0 0 0 / 0.7);
    }
    .gifv-toggle {
      position: relative; display: block; width: 100%; height: 100%;
      padding: 0; border-radius: 0; background: none;
    }
    .gif-badge {
      position: absolute; inset-block-start: var(--space-2); inset-inline-start: var(--space-2);
      padding: 0 var(--space-2); font-size: 0.75rem; font-weight: 700;
      color: #fff; background: rgb(0 0 0 / 0.7); border-radius: var(--radius-sm);
    }
    /* Without the Popover API a [popover] is an ordinary element; keep the
       description out of the grid then. The image alt still carries it. */
    @supports not selector(:popover-open) {
      [popover] { display: none; }
    }
    .alt-text {
      max-width: min(32rem, calc(100vw - 2rem)); padding: var(--space-3);
      color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      white-space: pre-wrap; overflow-wrap: anywhere;
    }
    /* Sensitive media: empty boxes of the right size under one button. */
    .reveal {
      position: absolute; inset: 0; width: 100%;
      color: var(--fg-0); background: var(--bg-2);
      font-weight: 600;
    }
    .hide {
      position: absolute; inset-block-start: var(--space-2); inset-inline-end: var(--space-2);
      padding: var(--space-1) var(--space-2); font-size: 0.75rem;
      color: #fff; background: rgb(0 0 0 / 0.7);
    }
    dialog {
      max-width: 95vw; max-height: 95vh; padding: var(--space-3);
      color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.85); }
    dialog img { width: auto; height: auto; max-width: 100%; max-height: 80vh; margin: 0 auto; object-fit: contain; }
    dialog p { margin: var(--space-2) 0 0; max-width: 60ch; white-space: pre-wrap; }
    dialog form { display: flex; justify-content: flex-end; margin-bottom: var(--space-2); }
    dialog form button { padding: var(--space-1) var(--space-3); color: var(--fg-0); background: var(--bg-2); }
  `]

  @property({ attribute: false }) media: Media[] = []
  @property({ type: Boolean }) sensitive = false

  @state() private revealed = false
  // The server cannot know the reader's motion setting, so the server and
  // the first client render both show each gifv paused. `firstUpdated`
  // decides.
  @state() private motionOk = false
  // A gifv the reader paused or played by hand, by index. It wins over the
  // motion setting (WCAG 2.2.2: a looping animation needs a way to stop).
  @state() private gifChoice: ReadonlyMap<number, boolean> = new Map()
  // The image the lightbox shows, by index.
  @state() private viewing = -1

  @query('dialog') private dialog!: HTMLDialogElement | null

  private opener: HTMLElement | null = null
  private motionQuery: MediaQueryList | null = null

  // Listen on every connect, so an element moved in the DOM keeps following
  // the setting. Before the first render only the listener is added:
  // `motionOk` must stay false until hydration is done.
  override connectedCallback() {
    super.connectedCallback()
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.motionQuery.addEventListener('change', this.onMotionChange)
    if (this.hasUpdated) this.onMotionChange()
  }

  override disconnectedCallback() {
    this.motionQuery?.removeEventListener('change', this.onMotionChange)
    this.motionQuery = null
    super.disconnectedCallback()
  }

  protected override firstUpdated() {
    this.onMotionChange()
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    // Another post in the same card starts hidden again, and its gifs follow
    // the motion setting again.
    if (changed.has('media') && changed.get('media') !== undefined) {
      this.revealed = false
      this.gifChoice = new Map()
    }
  }

  protected override updated() {
    for (const v of this.renderRoot.querySelectorAll<HTMLVideoElement>('video.gifv')) {
      if (this.gifPlaying(Number(v.dataset.index))) {
        void v.play().catch(() => { /* the browser refused; the poster shows */ })
      } else {
        v.pause()
      }
    }
  }

  private gifPlaying(index: number): boolean {
    return this.gifChoice.get(index) ?? this.motionOk
  }

  private toggleGif(index: number) {
    this.gifChoice = new Map(this.gifChoice).set(index, !this.gifPlaying(index))
  }

  // A new setting is the reader's latest word: it overrides their earlier
  // clicks on each gif.
  private onMotionChange = () => {
    const ok = !(this.motionQuery?.matches ?? true)
    if (ok !== this.motionOk && this.hasUpdated) this.gifChoice = new Map()
    this.motionOk = ok
  }

  // A plain click opens the lightbox; a modifier click or no JavaScript
  // follows the link to the file in a new tab.
  private onThumbClick = (e: MouseEvent, index: number) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    this.opener = e.currentTarget as HTMLElement
    this.viewing = index
    void this.updateComplete.then(() => this.dialog?.showModal())
  }

  private onDialogClose = () => {
    this.viewing = -1
    this.opener?.focus()
    this.opener = null
  }

  // A click on the backdrop lands on the dialog itself, and so does one on
  // its padding; only a point outside the dialog's box closes it.
  private onDialogClick = (e: MouseEvent) => {
    const dialog = this.dialog
    if (!dialog || e.target !== dialog) return
    const r = dialog.getBoundingClientRect()
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (!inside) dialog.close()
  }

  // The button clicked goes away; keep focus on the one that takes its place.
  private setRevealed(revealed: boolean) {
    this.revealed = revealed
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(revealed ? '.hide' : '.reveal')?.focus())
  }

  private renderAlt(m: Media, index: number) {
    if (!m.description) return nothing
    return html`
      <button type="button" class="alt" popovertarget="alt-${index}"
        aria-label="ALT, show the description">ALT</button>
      <div class="alt-text" id="alt-${index}" popover>${m.description}</div>
    `
  }

  private renderItem(m: Media, index: number) {
    const alt = m.description ?? ''
    const preview = httpUrl(m.previewUrl)
    const full = fullUrl(m)
    switch (m.type) {
      case 'image':
        return html`
          <a class="thumb" href=${ifDefined(full ?? preview)} target="_blank" rel="noopener noreferrer"
            aria-label=${alt ? `Open image: ${alt}` : 'Open image'}
            @click=${(e: MouseEvent) => this.onThumbClick(e, index)}>
            <img src=${ifDefined(preview ?? full)} alt=${alt} loading="lazy" decoding="async" />
          </a>
        `
      case 'gifv': {
        // The whole gif is a toggle button, as on Mastodon. A video with no
        // `controls` is not interactive, so it may sit inside a button.
        const playing = this.gifPlaying(index)
        return html`
          <button type="button" class="gifv-toggle" aria-pressed=${playing ? 'true' : 'false'}
            aria-label=${alt ? `Play GIF: ${alt}` : 'Play GIF'}
            @click=${() => this.toggleGif(index)}>
            <video class="gifv" data-index=${index} src=${ifDefined(full)} poster=${ifDefined(preview)}
              muted loop playsinline preload=${playing ? 'auto' : 'none'}></video>
            ${playing ? nothing : html`<span class="gif-badge" aria-hidden="true">▶ GIF</span>`}
          </button>
        `
      }
      case 'video':
        return html`
          <video src=${ifDefined(full)} poster=${ifDefined(preview)}
            aria-label=${ifDefined(alt || undefined)}
            controls playsinline preload="none"></video>
        `
      case 'audio':
        return html`
          <audio src=${ifDefined(full)} aria-label=${ifDefined(alt || undefined)}
            controls preload="none"></audio>
        `
      default:
        return html`
          <a class="file" href=${ifDefined(httpUrl(m.remoteUrl) ?? full)} target="_blank" rel="noopener noreferrer">
            ${alt || 'Open attachment'}
          </a>
        `
    }
  }

  private renderLightbox(items: Media[]) {
    if (!items.some((m) => m.type === 'image')) return nothing
    const m = this.viewing >= 0 ? items[this.viewing] : undefined
    const alt = m?.description ?? ''
    return html`
      <dialog aria-label=${alt || 'Image'} @close=${this.onDialogClose} @click=${this.onDialogClick}>
        ${m
          ? html`
              <form method="dialog"><button class="close">Close</button></form>
              <img src=${ifDefined(fullUrl(m) ?? httpUrl(m.previewUrl))} alt=${alt} />
              ${alt ? html`<p>${alt}</p>` : nothing}
            `
          : nothing}
      </dialog>
    `
  }

  override render() {
    const items = this.media.slice(0, MAX_ITEMS)
    if (items.length === 0) return nothing
    const hidden = this.sensitive && !this.revealed
    return html`
      <div class="media">
        <div class="grid" data-count=${items.length}>
          ${items.map((m, i) => html`
            <div class="item" data-type=${m.type} style="--ar: ${aspectOf(m)}">
              ${hidden ? nothing : this.renderItem(m, i)}${hidden ? nothing : this.renderAlt(m, i)}
            </div>
          `)}
        </div>
        ${!this.sensitive
          ? nothing
          : hidden
            ? html`<button type="button" class="reveal" @click=${() => this.setRevealed(true)}>Show sensitive media</button>`
            : html`<button type="button" class="hide" @click=${() => this.setRevealed(false)}>Hide</button>`}
        ${hidden ? nothing : this.renderLightbox(items)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-status-media': CaribouStatusMedia
  }
}
