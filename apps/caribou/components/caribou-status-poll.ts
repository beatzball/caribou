import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { Poll, Status } from '@beatzball/caribou-mastodon-client'
import { effect } from '@preact/signals-core'
import { cachedPoll, refreshPoll, votePoll } from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import './caribou-button.js'
import './caribou-icon.js'


// The end as the server prints it, and the first client render repeats:
// one fixed locale and UTC, so it reads the same whatever machine renders
// it. After mount the countdown replaces it.
function endLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })} UTC`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "3 days left", "5 hours left", "less than a minute left". */
export function timeLeft(expiresAt: string, now: number): string {
  const sec = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))
  if (sec < 60) return 'less than a minute left'
  if (sec < 3600) return `${plural(Math.floor(sec / 60), 'minute', 'minutes')} left`
  if (sec < 86_400) return `${plural(Math.floor(sec / 3600), 'hour', 'hours')} left`
  return `${plural(Math.floor(sec / 86_400), 'day', 'days')} left`
}

/**
 * Each option's share, as a whole percent. A multiple-choice poll divides
 * by the voters, as Mastodon does, so the shares can add up to more than
 * 100. Null when the server hides the counts until the poll ends.
 */
export function shares(poll: Poll): number[] | null {
  if (poll.options.some((o) => typeof o.votesCount !== 'number')) return null
  const total = poll.multiple ? (poll.votersCount ?? poll.votesCount) : poll.votesCount
  return poll.options.map((o) => total > 0 ? Math.round(((o.votesCount ?? 0) / total) * 100) : 0)
}

// The clock moves on while the poll is on screen.
const TICK_MS = 30_000

/**
 * A post's poll. The server and the first client render show the results
 * with the end time as a date: nothing there depends on the clock or the
 * reader. After mount the card says whether the reader can act on the post
 * (`interactive`); then an open poll the reader has not voted on shows its
 * choices and a Vote button, and the end time counts down. The poll is read
 * from the status cache after mount, so a vote shows in every copy of the
 * post at once. Option titles are plain text from the server.
 */
@customElement('caribou-status-poll')
export class CaribouStatusPoll extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; margin-top: var(--space-3); }
    .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    ul:focus { outline: none; }
    ul:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .choice label {
      display: flex; align-items: center; gap: var(--space-2);
      min-block-size: 2.25rem; padding: var(--space-1) var(--space-3);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      cursor: pointer; overflow-wrap: anywhere;
    }
    .choice label:hover { background: var(--bg-1); }
    .choice input { margin: 0; flex: none; accent-color: var(--accent); }
    .choice label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
    @media (pointer: coarse) {
      .choice label { min-block-size: 44px; }
    }
    .result { position: relative; padding: var(--space-1) var(--space-3); border-radius: var(--radius-md); overflow: hidden; }
    .result .bar {
      position: absolute; inset: 0 auto 0 0; width: var(--share, 0%);
      background: var(--bg-2); border-radius: var(--radius-md);
    }
    .result[data-leading] .bar { background: color-mix(in srgb, var(--accent) 30%, transparent); }
    .result .line { position: relative; display: flex; gap: var(--space-2); align-items: baseline; }
    .result .share { flex: none; min-width: 3ch; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--fg-0); }
    .result .title { min-width: 0; overflow-wrap: anywhere; color: var(--fg-0); }
    .result caribou-icon { flex: none; align-self: center; color: var(--accent); }
    .meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);
      margin-top: var(--space-2); color: var(--fg-muted); font-size: 0.875rem;
    }
    .meta p { margin: 0; }
  `]

  /** The post that holds the poll (the boosted one, for a boost). */
  @property({ attribute: false }) status: Status | null = null
  /** The reader can act on this post: signed in, on the post's server. */
  @property({ type: Boolean }) interactive = false

  // The cached copy of the poll, after mount.
  @state() private live: Poll | null = null
  // The clock, after mount. Null on the server and the first client render.
  @state() private now: number | null = null
  @state() private chosen: readonly number[] = []
  @state() private refreshing = false

  private dispose: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  // The poll id whose end this element has already asked the server about.
  private endAsked = ''

  protected override firstUpdated() {
    this.now = Date.now()
    this.bind()
    this.timer = setInterval(() => { this.now = Date.now() }, TICK_MS)
  }

  override connectedCallback() {
    super.connectedCallback()
    if (this.hasUpdated && !this.dispose) {
      this.bind()
      this.timer ??= setInterval(() => { this.now = Date.now() }, TICK_MS)
    }
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    clearInterval(this.timer)
    this.timer = undefined
    super.disconnectedCallback()
  }

  private bind() {
    this.dispose?.()
    this.dispose = effect(() => {
      const s = this.status
      const cached = s ? cachedPoll(s.id) : null
      const live = cached && cached.id === s?.poll?.id ? cached : null
      if (live !== this.live) this.live = live
    })
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (!changed.has('status')) return
    // A list hands the card a new copy of the same post whenever the cache
    // changes (the vote itself does); the picks stay unless the poll is
    // another one.
    const before = changed.get('status') as Status | null | undefined
    if (before && (before.id !== this.status?.id || before.poll?.id !== this.status?.poll?.id)) this.chosen = []
    if (this.dispose) this.bind()
  }

  protected override updated() {
    // The poll ended while on screen: ask once for the final counts.
    const poll = this.poll()
    if (!poll || !this.interactive || this.now === null || !this.status) return
    if (poll.expired || !this.endedByClock(poll) || this.endAsked === poll.id) return
    this.endAsked = poll.id
    void refreshPoll(this.status)
  }

  private poll(): Poll | null {
    return this.live ?? this.status?.poll ?? null
  }

  private endedByClock(poll: Poll): boolean {
    return this.now !== null && !!poll.expiresAt && Date.parse(poll.expiresAt) <= this.now
  }

  private onPick = (e: Event) => {
    const input = e.target as HTMLInputElement
    const i = Number(input.value)
    const poll = this.poll()
    if (!poll) return
    if (!poll.multiple) this.chosen = [i]
    else this.chosen = input.checked ? [...this.chosen.filter((x) => x !== i), i].sort((a, b) => a - b) : this.chosen.filter((x) => x !== i)
  }

  private onVote = async () => {
    const s = this.status
    if (!s || this.chosen.length === 0) return
    const choices = this.chosen
    // The vote shows at once: the choices give way to the results, so focus
    // goes there. A failure brings the choices back, with the Vote button
    // focused.
    const sent = votePoll(s, choices)
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>('ul.results')?.focus()
    if (await sent) {
      this.chosen = []
      return
    }
    await this.updateComplete
    this.renderRoot.querySelector<HTMLElement>('caribou-button.vote')?.focus()
  }

  private onRefresh = async () => {
    const s = this.status
    if (!s || this.refreshing) return
    this.refreshing = true
    try {
      await refreshPoll(s)
    } finally {
      this.refreshing = false
    }
  }

  override render() {
    const poll = this.poll()
    if (!poll) return nothing
    const ended = poll.expired || this.endedByClock(poll)
    const canVote = this.interactive && !ended && poll.voted !== true
    const voters = poll.votersCount ?? poll.votesCount
    const end = ended
      ? html`<span>Ended</span>`
      : !poll.expiresAt
      ? nothing
      : this.now === null
      ? html`<span>Ends <time datetime=${poll.expiresAt}>${endLabel(poll.expiresAt)}</time></span>`
      : html`<span><time datetime=${poll.expiresAt}>${timeLeft(poll.expiresAt, this.now)}</time></span>`
    return html`<div class="poll" data-state=${ended ? 'ended' : canVote ? 'open' : 'results'}>
      ${canVote ? this.renderChoices(poll) : this.renderResults(poll, ended)}
      <div class="meta">
        <p>${plural(voters, 'person', 'people')}${poll.voted ? ' · You voted' : ''}</p>
        ${end === nothing ? nothing : html`<p>${end}</p>`}
        ${canVote ? html`<p class="kind">${poll.multiple ? 'Choose one or more' : 'Choose one'}</p>` : nothing}
        ${this.interactive
          ? html`<caribou-button class="refresh" variant="secondary" ?loading=${this.refreshing}
              @click=${this.onRefresh}>Refresh<span class="vh"> poll results</span></caribou-button>`
          : nothing}
      </div>
    </div>`
  }

  private renderChoices(poll: Poll) {
    const type = poll.multiple ? 'checkbox' : 'radio'
    return html`<fieldset>
      <legend class="vh">Poll${poll.multiple ? ', choose one or more' : ', choose one'}</legend>
      <ul class="choices" role="list">
        ${poll.options.map((o, i) => html`<li class="choice">
          <label><input type=${type} name="choice" value=${String(i)}
            .checked=${this.chosen.includes(i)} @change=${this.onPick}><span>${o.title}</span></label>
        </li>`)}
      </ul>
      <div class="meta">
        <caribou-button class="vote" variant="primary" ?disabled=${this.chosen.length === 0}
          @click=${this.onVote}>Vote</caribou-button>
      </div>
    </fieldset>`
  }

  private renderResults(poll: Poll, ended: boolean) {
    const pct = shares(poll)
    const own = new Set(poll.ownVotes ?? [])
    const most = pct ? Math.max(...poll.options.map((o) => o.votesCount ?? 0)) : 0
    return html`<div>
      <ul class="results" role="list" tabindex="-1" aria-label="Poll results">
        ${poll.options.map((o, i) => {
          const share = pct?.[i]
          const leading = ended && pct !== null && most > 0 && (o.votesCount ?? 0) === most
          return html`<li class="result" ?data-leading=${leading} style=${share === undefined ? '' : `--share: ${share}%`}>
            ${share === undefined ? nothing : html`<span class="bar" aria-hidden="true"></span>`}
            <span class="line">
              ${share === undefined ? nothing : html`<span class="share">${share}%</span>`}
              <span class="title">${o.title}</span>
              ${leading ? html`<span class="vh">, most votes</span>` : nothing}
              ${own.has(i) ? html`<caribou-icon name="check"></caribou-icon><span class="vh">, your choice</span>` : nothing}
            </span>
          </li>`
        })}
      </ul>
      ${pct === null ? html`<p class="meta">Results show when the poll ends.</p>` : nothing}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-status-poll': CaribouStatusPoll }
}
