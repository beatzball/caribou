import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import type { MediaAttachment } from '@beatzball/caribou-mastodon-client'
import { boxReset } from './_shared-styles.js'
import { httpUrl } from './_http-url.js'
import './caribou-button.js'

type Media = MediaAttachment

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
    /* Two opaque strokes keep image pixels from erasing keyboard focus.
       Full-size controls stay inside the clipped grid; chips have room
       outside their text for the same contrasting strokes. */
    a.thumb:focus-visible, .gifv-toggle:focus-visible {
      outline: 2px solid var(--overlay-fg); outline-offset: -4px;
      box-shadow: inset 0 0 0 6px var(--overlay-bg);
    }
    .alt:focus-visible, caribou-button.hide::part(button):focus-visible {
      outline: 2px solid var(--overlay-fg); outline-offset: 2px;
      box-shadow: 0 0 0 6px var(--overlay-bg);
    }
    button {
      font: inherit; cursor: pointer; border: 0;
      border-radius: var(--radius-sm);
    }
    .alt {
      position: absolute; inset-block-end: var(--space-2); inset-inline-start: var(--space-2);
      padding: 0 var(--space-2); font-size: 0.75rem; font-weight: 700;
      color: var(--overlay-fg); background: var(--overlay-bg);
    }
    .gifv-toggle {
      position: relative; display: block; width: 100%; height: 100%;
      padding: 0; border-radius: 0; background: none;
    }
    .gif-badge {
      position: absolute; inset-block-start: var(--space-2); inset-inline-start: var(--space-2);
      padding: 0 var(--space-2); font-size: 0.75rem; font-weight: 700;
      color: var(--overlay-fg); background: var(--overlay-bg); border-radius: var(--radius-sm);
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
    caribou-button.reveal {
      position: absolute; inset: 0;
      font-weight: 600;
      --caribou-button-bg: var(--bg-2); --caribou-button-fg: var(--fg-0);
    }
    /* Hide is a chip on the media, like ALT. */
    caribou-button.hide {
      position: absolute; inset-block-start: var(--space-2); inset-inline-end: var(--space-2);
      font-size: 0.75rem;
      --caribou-button-size: 0;
      --caribou-button-bg: var(--overlay-bg); --caribou-button-fg: var(--overlay-fg);
    }
    caribou-button:is(.reveal, .hide)::part(button) {
      border: 0; border-radius: var(--radius-sm);
    }
    caribou-button.reveal::part(button) { block-size: 100%; }
    /* No-override: the same place as Show, but text, not a control. */
    .locked {
      position: absolute; inset: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      padding: var(--space-2); text-align: center; font-weight: 600;
      color: var(--fg-1); background: var(--bg-2);
      border-radius: var(--radius-sm);
    }
    caribou-button.hide::part(button) { padding: var(--space-1) var(--space-2); }
    /* Drawn over the media, so the ring goes inside the box. */
    caribou-button:is(.reveal, .hide)::part(button):focus-visible { outline-offset: -2px; }
    dialog {
      max-width: 95vw; max-height: 95vh; padding: var(--space-3);
      color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.85); }
    dialog img { width: auto; height: auto; max-width: 100%; max-height: 80vh; margin: 0 auto; object-fit: contain; }
    dialog p { margin: var(--space-2) 0 0; max-width: 60ch; white-space: pre-wrap; }
    dialog .bar { display: flex; justify-content: flex-end; margin-bottom: var(--space-2); }
  `]

  @property({ attribute: false }) media: Media[] = []
  @property({ type: Boolean }) sensitive = false
  // The reader opened the post's content warning, so sensitive media starts
  // shown. The Hide button still hides it.
  @property({ type: Boolean }) revealed = false
  // A Bluesky label the reader may not override (spec 7.4: an adult label
  // with adult content off, a no-override label, or one Caribou could not
  // check). Sensitive media then stays hidden: no Show button, and
  // `revealed` does not open it.
  @property({ type: Boolean, attribute: 'no-override' }) noOverride = false

  // The reader's own click on Show or Hide; null follows `revealed`.
  @state() private shown: boolean | null = null
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
    // Another post in the same card starts at `revealed` again, and its gifs follow
    // the motion setting again.
    if (changed.has('media') && changed.get('media') !== undefined) {
      this.shown = null
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
    // Focus Close by hand, as the edit history dialog does, rather than
    // trust the browser to find the button inside the shared control's root.
    void this.updateComplete.then(() => {
      this.dialog?.showModal()
      this.renderRoot.querySelector<HTMLElement>('caribou-button.close')?.focus()
    })
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
  private setShown(shown: boolean) {
    this.shown = shown
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(shown ? '.hide' : '.reveal')?.focus())
  }

  private renderAlt(m: Media, index: number) {
    if (!m.description) return nothing
    // Native: `popovertarget` is an id in this root, which cannot reach
    // into a shared control's own root (README, "Shared controls").
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
        // Native: the button is the media itself. A shared control draws a
        // control box (border, fill, accent when pressed) the gif would
        // have to undo (README, "Shared controls").
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
              <div class="bar"><caribou-button class="close" variant="secondary"
                @click=${() => this.dialog?.close()}>Close</caribou-button></div>
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
    const locked = this.sensitive && this.noOverride
    const hidden = locked || (this.sensitive && !(this.shown ?? this.revealed))
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
          : locked
            ? html`<p class="locked">Media hidden by a content label</p>`
          : hidden
            ? html`<caribou-button class="reveal" @click=${() => this.setShown(true)}>Show sensitive media</caribou-button>`
            : html`<caribou-button class="hide" @click=${() => this.setShown(false)}>Hide</caribou-button>`}
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
