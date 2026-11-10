// The compose dialog's link card watcher (#200). Rules 1 to 5: README,
// "Bluesky link cards". It holds no draft: the dialog hands it the current
// one, and it answers through `apply`. No SDK import: the dialog passes in
// `cardLink` and `fetchLinkCard` from the lazy Bluesky chunk.
import { css, html, type TemplateResult } from 'lit'
import { cardAllowed, type BlueskyDraftCard, type ComposeDraft } from '@beatzball/caribou-state'
import './caribou-button.js'
import type { LinkCardData } from '@beatzball/caribou-bluesky-client/browser'

/** Rule 3: the pause after the last change before the fetch starts. */
export const LINK_CARD_DELAY_MS = 600

export interface LinkCardWatcherOptions {
  /** The text's first http or https link (`cardLink`). */
  findLink: (text: string) => string | null
  /** The card for a link, or null (`fetchLinkCard`). Never throws. */
  fetchCard: (url: string, signal: AbortSignal) => Promise<LinkCardData | null>
  /** The dialog's draft now, or null when the dialog no longer owns it. */
  current: () => ComposeDraft | null
  /** Sets or removes the draft's card. */
  apply: (card: BlueskyDraftCard | null) => void
  delayMs?: number
}

export class LinkCardWatcher {
  private link: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private ctl: AbortController | null = null

  constructor(private readonly opts: LinkCardWatcherOptions) {}

  /** Looks at the draft after each change; starts, keeps or stops a fetch. */
  check(d: ComposeDraft): void {
    const b = d.bluesky
    if (!b) return this.stop()
    const card = b.card ?? null
    // Rule 2: no card, and no fetch, beside images or a quote.
    if (!cardAllowed(d)) {
      this.stop()
      if (card) this.opts.apply(null)
      return
    }
    // Rule 1: the card follows the first link.
    const link = this.opts.findLink(d.text)
    if (card && card.uri === link) return this.stop()
    if (card) this.opts.apply(null)
    // Rule 5: a removed card stays removed for its link.
    if (!link || link === b.cardDismissed) return this.stop()
    if (link === this.link) return
    this.stop()
    this.link = link
    this.timer = setTimeout(() => void this.run(link), this.opts.delayMs ?? LINK_CARD_DELAY_MS)
  }

  /** Drops the pending fetch, if any (rule 3: a newer link aborts it). */
  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.ctl?.abort()
    this.timer = null
    this.ctl = null
    this.link = null
  }

  private async run(link: string): Promise<void> {
    this.timer = null
    const ctl = new AbortController()
    this.ctl = ctl
    let data: LinkCardData | null = null
    try {
      data = await this.opts.fetchCard(link, ctl.signal)
    } catch {
      // C1: a card is extra; a failure is no card.
    }
    if (ctl.signal.aborted) return
    this.ctl = null
    this.link = null
    // Rule 4: a late answer is used only for the same link, dialog and account.
    const d = this.opts.current()
    if (!data || !d?.bluesky || !cardAllowed(d) || d.bluesky.card) return
    if (this.opts.findLink(d.text) !== link || d.bluesky.cardDismissed === link) return
    this.opts.apply({ ...data, uri: link, thumb: null })
  }
}

/** The link's host, for the preview. */
function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

/** Rule 6: the preview, with its remove button (rule 5). */
export function renderLinkCardPreview(card: BlueskyDraftCard, busy: boolean, onRemove: () => void): TemplateResult {
  return html`
    <div class="link-card" data-link-card>
      ${card.image ? html`<img src=${card.image} alt="" referrerpolicy="no-referrer">` : ''}
      <div class="link-card-text">
        <span class="link-card-host">${hostOf(card.uri)}</span>
        <strong class="link-card-title">${card.title}</strong>
        ${card.description ? html`<span class="link-card-description">${card.description}</span>` : ''}
      </div>
      <caribou-button data-action="remove-link-card" ?disabled=${busy} @click=${onRemove}>Remove<span class="visually-hidden"> link card</span></caribou-button>
    </div>`
}

export const linkCardStyles = css`
  .link-card { display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-md); min-width: 0; }
  .link-card img { inline-size: 5rem; block-size: 5rem; flex: none; object-fit: cover; border-radius: var(--radius-sm); background: var(--bg-2); }
  .link-card-text { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; min-width: 0; }
  .link-card-host { color: var(--fg-muted); font-size: 0.875em; overflow-wrap: anywhere; }
  .link-card-title { overflow-wrap: anywhere; }
  .link-card-description { color: var(--fg-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
`
