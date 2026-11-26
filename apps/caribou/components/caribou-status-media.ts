import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import type { MediaAttachment } from '@beatzball/caribou-mastodon-client'
import { boxReset } from './_shared-styles.js'
import { httpUrl } from './_http-url.js'
import {
  IDENTITY, KEY_STEP, PAN_STEP, clampPan, doubleTap, isZoomed, panBy, pinch, transformOf,
  wheelScale, zoomAt, type Bounds, type Point, type Zoom,
} from './_media-zoom.js'
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

// Two taps closer than this, in time and space, are a double tap.
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
// A pointer that moves less than this before it lifts is a tap.
const TAP_SLOP_PX = 10

// Safari's own pinch events: trackpad pinch on macOS, and pinch on iOS
// next to the touches. Not in the DOM types.
interface GestureEvent extends UIEvent {
  readonly scale: number
  readonly clientX: number
  readonly clientY: number
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
    .thumb { position: relative; display: block; width: 100%; height: 100%; }
    img, video { display: block; width: 100%; height: 100%; object-fit: cover; }
    .grid[data-count="1"] img, .grid[data-count="1"] video { object-fit: contain; }
    audio { width: 100%; padding: var(--space-2); }
    .file { padding: var(--space-3); color: var(--accent); overflow-wrap: anywhere; }
    a:focus-visible, button:focus-visible {
      outline: 2px solid var(--accent); outline-offset: -2px;
    }
    /* Draw above opaque image/video children: a parent's inset shadow
       would paint underneath them. Keep the strokes inside the clipped
       grid and let pointer events reach the existing media control. */
    a.thumb:focus-visible, .gifv-toggle:focus-visible { outline: none; }
    a.thumb:focus-visible::after, .gifv-toggle:focus-visible::after {
      content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
      border: 2px solid var(--overlay-bg);
      box-shadow: inset 0 0 0 2px var(--overlay-fg), inset 0 0 0 4px var(--overlay-bg);
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
      min-inline-size: 24px; min-block-size: 24px;
      padding: 0 var(--space-2); font-size: 0.75rem; font-weight: 700;
      color: var(--overlay-fg); background: var(--overlay-bg);
    }
    @media (pointer: coarse) {
      .alt { min-inline-size: 44px; min-block-size: 44px; }
    }
    /* Keep ALT clear of the native video control bar. Audio and file
       descriptions have their own row, rather than cover their controls. */
    .item[data-type="video"] .alt { inset-block: var(--space-2) auto; }
    .item:is([data-type="audio"], [data-type="unknown"]) { flex-direction: column; }
    .item:is([data-type="audio"], [data-type="unknown"]) .alt {
      position: static; align-self: flex-start; margin: var(--space-2);
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
    /* The viewer fills most of the screen, so a zoomed image has room. */
    dialog {
      width: 95vw; height: 95vh; height: 95dvh;
      max-width: 95vw; max-height: 95vh; max-height: 95dvh; padding: var(--space-3);
      color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.85); }
    /* Not on a closed dialog: its own display: none must win. */
    dialog[open] { display: flex; flex-direction: column; }
    /* The zoom surface: the dialog's free height, at least half the screen.
       It takes pinch and pan from the browser, so the page does not zoom;
       the rest of the dialog and the page keep page zoom. It clips the
       zoomed image, so the Close bar stays clear. */
    dialog .stage {
      position: relative; flex: 1 1 auto; min-height: 50vh;
      overflow: hidden; touch-action: none;
      user-select: none; -webkit-user-select: none;
    }
    /* At 1x the image fits the stage, centered, and is never made bigger
       than its file. */
    dialog .stage img {
      display: block; position: absolute; inset: 0; margin: auto;
      width: auto; height: auto; max-width: 100%; max-height: 100%;
      object-fit: contain;
    }
    dialog .stage[data-zoomed] { cursor: grab; }
    dialog .stage[data-zoomed][data-dragging] { cursor: grabbing; }
    dialog .stage img { -webkit-user-drag: none; transition: transform 0.2s ease-out; }
    /* A finger or wheel moves the image itself; only a double tap or a key
       eases. */
    dialog .stage[data-instant] img { transition: none; }
    @media (prefers-reduced-motion: reduce) {
      dialog .stage img { transition: none; }
    }
    dialog p { flex: none; margin: var(--space-2) 0 0; max-width: 60ch; white-space: pre-wrap; }
    dialog .bar {
      flex: none; display: flex; align-items: center; justify-content: space-between;
      gap: var(--space-2); margin-bottom: var(--space-2);
    }
    dialog .bar caribou-button { margin-inline-start: auto; }
    .hint { font-size: 0.875rem; color: var(--fg-1); }
    /* No keyboard to speak of; the dialog still names the keys. */
    @media (pointer: coarse) {
      .hint { display: none; }
    }
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
  @query('dialog .stage') private stage!: HTMLElement | null
  @query('dialog .stage img') private zoomImg!: HTMLImageElement | null

  private opener: HTMLElement | null = null
  private motionQuery: MediaQueryList | null = null

  // The lightbox image's zoom. It is written to the image's style by hand,
  // not rendered: a pointer move must not wait for an update.
  private zoom: Zoom = IDENTITY
  // Pointers down on the zoom surface, by id, at their latest place.
  private pointers = new Map<number, Point>()
  // Where the current gesture started: the zoom then, and the pointers.
  // A pointer that goes down or up starts a new one from where things are.
  private gesture: { zoom: Zoom; points: Point[] } | null = null
  // A single pointer that has not moved yet may be a tap.
  private tap: { id: number; x: number; y: number } | null = null
  private lastTap: { x: number; y: number; time: number } | null = null
  // A Safari trackpad pinch, from the zoom it started at.
  private safariPinch: Zoom | null = null

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
    window.removeEventListener('resize', this.onResize)
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
    this.resetZoom()
    this.viewing = index
    // Focus Close by hand, as the edit history dialog does, rather than
    // trust the browser to find the button inside the shared control's root.
    void this.updateComplete.then(() => {
      this.dialog?.showModal()
      this.renderRoot.querySelector<HTMLElement>('caribou-button.close')?.focus()
      window.addEventListener('resize', this.onResize)
    })
  }

  private onDialogClose = () => {
    window.removeEventListener('resize', this.onResize)
    this.resetZoom()
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

  // ---- Zoom -------------------------------------------------------------

  // The image's size at 1x, and the stage's. The transform changes
  // neither.
  private bounds(): Bounds {
    const img = this.zoomImg
    const stage = this.stage
    return {
      image: { width: img?.offsetWidth ?? 0, height: img?.offsetHeight ?? 0 },
      stage: { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 },
    }
  }

  // A point on screen, from the image's center at 1x. The image is
  // centered in the stage, and the stage is never transformed.
  private fromCenter(clientX: number, clientY: number): Point {
    const r = this.stage?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
  }

  private setZoom(next: Zoom, ease = false) {
    this.zoom = next
    const stage = this.stage
    const img = this.zoomImg
    if (!stage || !img) return
    stage.toggleAttribute('data-instant', !ease)
    stage.toggleAttribute('data-zoomed', isZoomed(next))
    img.style.transform = transformOf(next)
  }

  private resetZoom() {
    this.pointers.clear()
    this.gesture = null
    this.tap = null
    this.lastTap = null
    this.safariPinch = null
    this.stage?.removeAttribute('data-dragging')
    this.setZoom(IDENTITY)
  }

  // A new window size moves the image's bounds; keep it inside them.
  private onResize = () => {
    this.setZoom(clampPan(this.zoom, this.bounds()))
  }

  // Start the gesture again from the zoom and pointers as they are now.
  private restartGesture() {
    const points = [...this.pointers.values()].slice(0, 2)
      .map((p) => this.fromCenter(p.x, p.y))
    this.gesture = points.length ? { zoom: this.zoom, points } : null
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return
      // No text selection or image drag; focus stays where it is.
      e.preventDefault()
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch { /* not an active pointer, as for a synthetic event */ }
    this.tap = this.pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null
    this.stage?.toggleAttribute('data-dragging', true)
    this.restartGesture()
  }

  private onPointerMove = (e: PointerEvent) => {
    const last = this.pointers.get(e.pointerId)
    if (!last) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > TAP_SLOP_PX) {
      this.tap = null
    }
    const g = this.gesture
    if (!g) return
    const now = [...this.pointers.values()].slice(0, 2).map((p) => this.fromCenter(p.x, p.y))
    const b = this.bounds()
    if (now.length >= 2 && g.points.length >= 2) {
      const [a0, b0] = g.points as [Point, Point]
      const [a1, b1] = now as [Point, Point]
      this.setZoom(pinch(g.zoom, distance(a0, b0), midpoint(a0, b0), distance(a1, b1), midpoint(a1, b1), b))
    } else if (isZoomed(this.zoom) && now.length === 1 && g.points.length === 1) {
      const p0 = g.points[0]!
      const p1 = now[0]!
      this.setZoom(panBy(g.zoom, p1.x - p0.x, p1.y - p0.y, b))
    } else if (e.pointerType !== 'mouse' && this.pointers.size === 1) {
      // At 1x a finger on the image still scrolls a long description into
      // view; the surface took that from the browser with the pinch.
      this.dialog?.scrollBy(0, last.y - e.clientY)
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return
    const tapped = e.type === 'pointerup' && this.tap?.id === e.pointerId
    this.tap = null
    if (this.pointers.size === 0) this.stage?.removeAttribute('data-dragging')
    this.restartGesture()
    if (tapped) this.onTap(e.clientX, e.clientY, e.timeStamp)
  }

  private onTap(clientX: number, clientY: number, time: number) {
    const last = this.lastTap
    if (last && time - last.time < DOUBLE_TAP_MS && Math.hypot(clientX - last.x, clientY - last.y) < DOUBLE_TAP_PX) {
      this.lastTap = null
      this.setZoom(doubleTap(this.zoom, this.fromCenter(clientX, clientY), this.bounds()), true)
    } else {
      this.lastTap = { x: clientX, y: clientY, time }
    }
  }

  // Ctrl+wheel, and a trackpad pinch outside Safari, zoom the image, not
  // the page. A plain wheel pans a zoomed image, and scrolls as usual at 1x.
  private onWheel = (e: WheelEvent) => {
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.bounds().stage.height : 1
    if (e.ctrlKey) {
      e.preventDefault()
      // Safari's own pinch events have it.
      if (this.safariPinch) return
      const scale = wheelScale(this.zoom.scale, e.deltaY * unit)
      this.setZoom(zoomAt(this.zoom, scale, this.fromCenter(e.clientX, e.clientY), this.bounds()))
    } else if (isZoomed(this.zoom)) {
      e.preventDefault()
      this.setZoom(panBy(this.zoom, -e.deltaX * unit, -e.deltaY * unit, this.bounds()))
    }
  }

  // Lit passes the options on: the handler must be able to cancel.
  private wheelListener = { handleEvent: this.onWheel, passive: false }

  // Safari sends pinch as its own events. Cancel them always, so the page
  // never zooms from here. With touches down the pointer handlers do the
  // zoom; with none it is a macOS trackpad, and these do.
  private onGestureStart = (e: Event) => {
    e.preventDefault()
    this.safariPinch = this.pointers.size === 0 ? this.zoom : null
  }

  private onGestureChange = (e: Event) => {
    e.preventDefault()
    const start = this.safariPinch
    // Fingers down: the pointer handlers zoom. The second check holds even
    // if iOS sends this before both pointerdowns.
    if (!start || this.pointers.size > 0 || this.gesture?.points.length === 2) return
    const g = e as GestureEvent
    this.setZoom(zoomAt(start, start.scale * g.scale, this.fromCenter(g.clientX, g.clientY), this.bounds()))
  }

  private onGestureEnd = (e: Event) => {
    e.preventDefault()
    this.safariPinch = null
  }

  // `+` / `=` zoom in, `-` zooms out, `0` resets, about the image's center.
  // On a zoomed image the arrows show more of that side. With ctrl or cmd
  // the keys stay the browser's page zoom; at 1x the arrows scroll as usual.
  private onDialogKeydown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !this.zoomImg) return
    const b = this.bounds()
    const center = { x: 0, y: 0 }
    const dx = b.stage.width * PAN_STEP
    const dy = b.stage.height * PAN_STEP
    const zoomed = isZoomed(this.zoom)
    let next: Zoom
    if (e.key === '+' || e.key === '=') next = zoomAt(this.zoom, this.zoom.scale * KEY_STEP, center, b)
    else if (e.key === '-' || e.key === '_') next = zoomAt(this.zoom, this.zoom.scale / KEY_STEP, center, b)
    else if (e.key === '0') next = IDENTITY
    else if (zoomed && e.key === 'ArrowLeft') next = panBy(this.zoom, dx, 0, b)
    else if (zoomed && e.key === 'ArrowRight') next = panBy(this.zoom, -dx, 0, b)
    else if (zoomed && e.key === 'ArrowUp') next = panBy(this.zoom, 0, dy, b)
    else if (zoomed && e.key === 'ArrowDown') next = panBy(this.zoom, 0, -dy, b)
    else return
    e.preventDefault()
    this.setZoom(next, true)
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
      <dialog aria-label=${alt || 'Image'} aria-describedby=${ifDefined(m ? 'zoom-hint' : undefined)}
        @close=${this.onDialogClose} @click=${this.onDialogClick} @keydown=${this.onDialogKeydown}>
        ${m
          ? html`
              <div class="bar">
                <span class="hint" id="zoom-hint">Keys: + and − to zoom, arrows to move, 0 to reset</span>
                <caribou-button class="close" variant="secondary"
                  @click=${() => this.dialog?.close()}>Close</caribou-button>
              </div>
              <div class="stage"
                @pointerdown=${this.onPointerDown} @pointermove=${this.onPointerMove}
                @pointerup=${this.onPointerUp} @pointercancel=${this.onPointerUp}
                @wheel=${this.wheelListener}
                @gesturestart=${this.onGestureStart} @gesturechange=${this.onGestureChange}
                @gestureend=${this.onGestureEnd}>
                <img src=${ifDefined(fullUrl(m) ?? httpUrl(m.previewUrl))} alt=${alt} draggable="false" />
              </div>
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

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-status-media': CaribouStatusMedia
  }
}
