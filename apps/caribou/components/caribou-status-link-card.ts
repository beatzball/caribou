import { LitElement, html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { mastodon } from 'masto'
import { boxReset } from './_shared-styles.js'
import { httpUrl } from './_http-url.js'

// Mastodon 4 sends `image_description`; masto.js does not type it yet.
export type LinkCard = mastodon.v1.PreviewCard & { imageDescription?: string | null }

export type LinkCardLayout = 'large' | 'compact' | 'text'

// An image this wide fills the card's width without looking blown up.
const LARGE_MIN_WIDTH = 400

export function cardLayout(card: LinkCard): LinkCardLayout {
  if (!httpUrl(card.image)) return 'text'
  const wide = (card.width ?? 0) >= LARGE_MIN_WIDTH
  // As on Mastodon: a wide link, video or photo card is large; a rich card
  // (an embed with no fixed shape) stays compact.
  return wide && card.type !== 'rich' ? 'large' : 'compact'
}

// Width over height, so the image box holds its place before the file
// arrives. Without a size, the common Open Graph shape (1200×630).
export function cardAspect(card: LinkCard): number {
  const ratio = card.width && card.height ? card.width / card.height : 0
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1200 / 630
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

// The site name, then the author; the host when the card names neither.
function byline(card: LinkCard, href: string): string {
  const author = card.authorName || card.authors?.[0]?.name || ''
  return [card.providerName || hostOf(href), author].filter(Boolean).join(' · ')
}

// The link preview card under a post's text. Every string is the remote
// server's, so all of it is rendered as text. `card.html` (an embed) is never
// rendered: a video card shows its image only.
@customElement('caribou-status-link-card')
export class CaribouStatusLinkCard extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; margin-top: var(--space-3); }
    a {
      display: flex; overflow: hidden;
      color: inherit; text-decoration: none;
      border: 1px solid var(--border); border-radius: var(--radius-md);
    }
    a:hover { background: var(--bg-1); }
    a:hover .title { text-decoration: underline; }
    a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    a[data-layout="large"] { flex-direction: column; }
    /* The image sits on top of a box sized only by aspect-ratio, so the file
       cannot change the box's size when it loads. */
    .image { position: relative; flex: none; background: var(--bg-2); }
    [data-layout="large"] .image { width: 100%; aspect-ratio: var(--ar); max-height: 20rem; }
    [data-layout="compact"] .image { width: 6rem; aspect-ratio: 1; align-self: flex-start; }
    img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
    .text {
      display: flex; flex-direction: column; gap: var(--space-1);
      min-width: 0; padding: var(--space-3);
    }
    .details { display: flex; flex-direction: column; gap: var(--space-1); }
    .title, .description { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .title { -webkit-line-clamp: 2; line-clamp: 2; color: var(--fg-0); font-weight: 600; }
    .description { -webkit-line-clamp: 3; line-clamp: 3; color: var(--fg-1); font-size: 0.875rem; }
    .byline {
      color: var(--fg-muted); font-size: 0.75rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
  `]

  @property({ attribute: false }) card: LinkCard | null = null

  override render() {
    const card = this.card
    const href = httpUrl(card?.url)
    if (!card || !href || !card.title) return nothing
    const layout = cardLayout(card)
    const image = httpUrl(card.image)
    // The title alone names the link; the rest describes it.
    return html`
      <a href=${href} target="_blank" rel="noopener noreferrer" data-layout=${layout}
        aria-labelledby="title" aria-describedby="details">
        ${layout === 'text' ? nothing : html`
          <div class="image" style="--ar: ${cardAspect(card)}">
            <img src=${image} alt=${card.imageDescription ?? ''} loading="lazy" decoding="async" />
          </div>
        `}
        <div class="text">
          <span class="title" id="title">${card.title}</span>
          <span class="details" id="details">
            ${card.description ? html`<span class="description">${card.description}</span>` : nothing}
            <span class="byline">${byline(card, href)}</span>
          </span>
        </div>
      </a>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caribou-status-link-card': CaribouStatusLinkCard
  }
}
