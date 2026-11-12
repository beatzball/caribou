import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import type { PreviewCard } from '@beatzball/caribou-mastodon-client'
import type Hls from 'hls.js'
import { boxReset } from './_shared-styles.js'
import { httpUrl } from './_http-url.js'
import { loadHls } from './_hls-loader.js'

// A Bluesky video in the card (spec 7.3, phase 6). The rules are numbered
// in the README, "Bluesky video"; the comments name them.

const HLS_TYPE = 'application/vnd.apple.mpegurl'
// The mapper's title when the video has no alt text (bluesky-client README).
const NO_ALT_TITLE = 'Video'

type Phase = 'idle' | 'playing' | 'error'

// Width over height from the embed's aspect ratio, 16:9 without one (rule 5).
export function videoAspect(card: PreviewCard): number {
  const ratio = card.width && card.height ? card.width / card.height : 0
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
}

// Media Source Extensions, by name only: nothing loads (rule 3).
// `ManagedMediaSource` is Safari's (iPhone 17.1 and later).
function hasMediaSource(): boolean {
  return typeof globalThis.MediaSource === 'function'
    || typeof (globalThis as { ManagedMediaSource?: unknown }).ManagedMediaSource === 'function'
}

function altOf(card: PreviewCard): string {
  return card.title === NO_ALT_TITLE ? '' : card.title
}

@customElement('caribou-bluesky-video')
export class CaribouBlueskyVideo extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; margin-top: var(--space-3); }
    .box {
      position: relative; width: 100%; aspect-ratio: var(--ar); max-height: 32rem;
      overflow: hidden; border-radius: var(--radius-md); background: var(--bg-2);
    }
    .poster { position: absolute; inset: 0; display: block; }
    img, video { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; }
    video { background: #000; }
    .play {
      position: absolute; inset: 0; margin: auto; width: 3.5rem; height: 3.5rem;
      display: grid; place-items: center; padding-inline-start: 0.2rem;
      color: #fff; background: rgb(0 0 0 / 0.6); border-radius: 50%; font-size: 1.5rem;
    }
    .poster:hover .play { background: rgb(0 0 0 / 0.8); }
    a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .alt {
      /* At the top, clear of the video's controls. */
      position: absolute; inset-block-start: var(--space-2); inset-inline-start: var(--space-2);
      padding: 0 var(--space-2); font: inherit; font-size: 0.75rem; font-weight: 700;
      color: #fff; background: rgb(0 0 0 / 0.7); border: 0; border-radius: var(--radius-sm); cursor: pointer;
    }
    @supports not selector(:popover-open) {
      [popover] { display: none; }
    }
    .alt-text {
      max-width: min(32rem, calc(100vw - 2rem)); padding: var(--space-3);
      color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .error {
      position: absolute; inset-inline: 0; inset-block-end: 0; margin: 0;
      padding: var(--space-2) var(--space-3);
      color: var(--fg-0); background: var(--bg-1); border-top: 1px solid var(--border);
    }
    .error a { color: var(--accent); }
    .no-thumb {
      position: absolute; inset: 0; display: flex; align-items: flex-end;
      padding: var(--space-3); padding-block-end: var(--space-5, 2.5rem);
      color: var(--fg-1); overflow-wrap: anywhere; overflow: hidden;
    }
  `]

  @property({ attribute: false }) card: PreviewCard | null = null

  @state() private phase: Phase = 'idle'

  @query('video') private video!: HTMLVideoElement | null

  private hls: Hls | null = null
  private playback: 'native' | 'hls' | 'retry' | null = null
  // Bumped on every stop, so a load of hls.js that lands after the reader
  // left (or after a new card) does nothing (rule 8).
  private run = 0

  override disconnectedCallback() {
    this.stop()
    this.phase = 'idle'
    super.disconnectedCallback()
  }

  // Rule 8: only another video stops this one. A fresh copy of the same
  // post (a timeline poll maps it again) is a new object with the same
  // playlist and link, and keeps playing.
  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (!changed.has('card')) return
    const old = changed.get('card') as PreviewCard | null | undefined
    if (old === undefined) return
    const same = httpUrl(old?.embedUrl) === httpUrl(this.card?.embedUrl) && httpUrl(old?.url) === httpUrl(this.card?.url)
    if (!same) {
      this.stop()
      this.phase = 'idle'
    }
  }

  // Rule 8: destroy hls.js and take the source off the <video>.
  private stop() {
    this.run++
    this.playback = null
    this.hls?.destroy()
    this.hls = null
    const v = this.video
    if (v) {
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  }

  // Rule 12: the error takes focus only when the reader's focus was on the
  // player. Focus the reader moved elsewhere stays where it is.
  private fail() {
    const hadFocus = this.renderRoot instanceof ShadowRoot && this.renderRoot.activeElement !== null
    this.stop()
    this.phase = 'error'
    if (hadFocus) {
      void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.error a')?.focus())
    }
  }

  // Rule 2: a plain click plays in place; a modifier click, or no
  // JavaScript, opens the post on bsky.app.
  private onPosterClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    this.start()
  }

  // Rule 2: the control plays, so Space plays too, as on a button. Enter
  // already fires a click.
  private onPosterKeydown = (e: KeyboardEvent) => {
    if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    this.start()
  }

  // Rule 12: the <video> replaces the poster and takes its focus at once,
  // before any download. Nothing focuses it later.
  private start() {
    if (this.phase === 'playing') return
    this.phase = 'playing'
    const run = ++this.run
    void this.updateComplete.then(() => {
      if (run !== this.run) return
      this.video?.focus()
      void this.attach(run)
    })
  }

  private async attach(run: number) {
    const v = this.video
    const playlist = httpUrl(this.card?.embedUrl)
    if (!v || !playlist || run !== this.run) return
    const native = v.canPlayType(HLS_TYPE) !== ''
    // Rule 3: hls.js first wherever there is MSE, whatever `canPlayType`
    // says (#277: Vivaldi answers "maybe" and then cannot play).
    if (hasMediaSource()) {
      const attached = await this.attachHls(v, playlist, run)
      if (run !== this.run || attached) return
    }
    // Rule 4: native HLS only where hls.js cannot run.
    if (!native) { this.fail(); return }
    this.playback = 'native'
    v.src = playlist
    void v.play().catch(() => { /* the browser refused; the controls stay */ })
  }

  // Rule 3: hls.js, loaded now and only now. False when it cannot run here
  // (it did not load, or it is not supported), so rule 4 can try native.
  private async attachHls(v: HTMLVideoElement, playlist: string, run: number): Promise<boolean> {
    let HlsClass: typeof Hls
    try {
      HlsClass = (await loadHls()).default
    } catch {
      return false
    }
    if (run !== this.run || !HlsClass.isSupported()) return false
    const h = new HlsClass()
    this.hls = h
    this.playback = 'hls'
    h.on(HlsClass.Events.ERROR, (_event, data) => {
      if (data.fatal && this.hls === h) this.fail()
    })
    h.loadSource(playlist)
    h.attachMedia(v)
    void v.play().catch(() => { /* the browser refused; the controls stay */ })
    return true
  }

  private onVideoError = () => {
    if (this.phase !== 'playing' || this.playback === 'retry') return
    if (this.playback === 'native' && hasMediaSource()) {
      // Rule 4: one retry after a native error. Mark it before awaiting the
      // import, so duplicate errors cannot start another retry or end it.
      this.playback = 'retry'
      void this.retryNative(this.run)
    } else {
      this.fail()
    }
  }

  private async retryNative(run: number) {
    const v = this.video
    const playlist = httpUrl(this.card?.embedUrl)
    if (!v || !playlist) { this.fail(); return }
    // Clear the native error before hls.js attaches to the same player.
    // Keep the element and focus; only fail() may move focus (rule 12).
    v.removeAttribute('src')
    v.load()
    const attached = await this.attachHls(v, playlist, run)
    if (run === this.run && !attached) this.fail()
  }

  private renderAlt(alt: string) {
    if (!alt) return nothing
    // Native, as on images (caribou-status-media): `popovertarget` names an
    // id in this root.
    return html`
      <button type="button" class="alt" popovertarget="alt"
        aria-label="ALT, show the description">ALT</button>
      <div class="alt-text" id="alt" popover>${alt}</div>
    `
  }

  override render() {
    const card = this.card
    const href = httpUrl(card?.url)
    if (!card || !href || !httpUrl(card.embedUrl)) return nothing
    const alt = altOf(card)
    const thumb = httpUrl(card.image) ?? undefined
    // Rule 5: a thumbnail the mapper rejected leaves the alt text (or
    // "Video") in the box, not an empty box.
    const poster = thumb
      ? html`<img src=${thumb} alt="" loading="lazy" decoding="async" />`
      : html`<span class="no-thumb">${card.title || NO_ALT_TITLE}</span>`
    return html`
      <div class="box" style="--ar: ${videoAspect(card)}">
        ${this.phase === 'playing'
          ? html`<video poster=${ifDefined(thumb)} aria-label=${alt || NO_ALT_TITLE}
              controls playsinline preload="none" @error=${this.onVideoError}></video>`
          : this.phase === 'error'
            ? poster
            : html`<a class="poster" href=${href} target="_blank" rel="noopener noreferrer"
                aria-label=${alt ? `Play video: ${alt}` : 'Play video'} @click=${this.onPosterClick} @keydown=${this.onPosterKeydown}>
                ${poster}<span class="play" aria-hidden="true">▶</span>
              </a>`}
        ${this.phase === 'error'
          ? html`<p class="error" role="alert">This video could not play.
              <a href=${href} target="_blank" rel="noopener noreferrer">Watch on bsky.app</a></p>`
          : nothing}
        ${this.phase === 'error' ? nothing : this.renderAlt(alt)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-bluesky-video': CaribouBlueskyVideo
  }
}
