// Phase-0 spike (#170): loopback sign-in + Following. Dev only; never merged.
import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import type * as SpikeModule from '../components/_bsky-spike.js'
import type { FollowingItem } from '../components/_bsky-spike.js'

type Spike = typeof SpikeModule
const loadSpike = (): Promise<Spike> => import('../components/_bsky-spike.js')

@customElement('page-dev-bluesky')
export class DevBlueskyPage extends LitroPage {
  static override styles = [pageReset, css`
    main { color: var(--fg-1); padding: 1rem; max-width: 640px; }
    li { margin: .5rem 0; }
    pre { white-space: pre-wrap; color: var(--fg-2, inherit); }
  `]

  @state() private status = 'Loading the Bluesky chunk…'
  @state() private did: string | null = null
  @state() private items: FollowingItem[] = []
  @state() private handle = ''

  override async firstUpdated(): Promise<void> {
    try {
      const t0 = performance.now()
      const spike = await loadSpike()
      const t1 = performance.now()
      const s = await spike.initSession()
      this.did = s?.did ?? null
      this.status = `Chunk loaded in ${Math.round(t1 - t0)} ms. ${s ? `Signed in as ${s.did}.` : 'Not signed in.'}`
      if (s) await this.loadFollowing()
    } catch (err) {
      this.status = `Error: ${String(err)}`
    }
  }

  private async loadFollowing(): Promise<void> {
    if (!this.did) return
    try {
      this.items = await (await loadSpike()).fetchFollowing(this.did)
      this.status += ` Following: ${this.items.length} posts.`
    } catch (err) {
      this.status = `Following failed: ${String(err)}`
    }
  }

  private async onSignIn(e: Event): Promise<void> {
    e.preventDefault()
    try {
      await (await loadSpike()).signIn(this.handle.trim())
    } catch (err) {
      this.status = `Sign-in failed: ${String(err)}`
    }
  }

  private async onSignOut(): Promise<void> {
    if (!this.did) return
    await (await loadSpike()).signOut(this.did)
    this.did = null
    this.items = []
    this.status = 'Signed out.'
  }

  override render() {
    return html`
      <main>
        <h1>Bluesky spike (dev only)</h1>
        <p role="status">${this.status}</p>
        ${this.did
          ? html`<button @click=${() => this.onSignOut()}>Sign out</button>
              <ol>${this.items.map((i) => html`<li><b>@${i.handle}</b>${i.reposted ? ' (repost)' : ''}<pre>${i.text}</pre></li>`)}</ol>`
          : html`<form @submit=${(e: Event) => this.onSignIn(e)}>
              <label>Handle <input name="handle" .value=${this.handle}
                @input=${(e: Event) => { this.handle = (e.target as HTMLInputElement).value }}></label>
              <button type="submit">Sign in with Bluesky</button>
            </form>`}
      </main>
    `
  }
}

export default DevBlueskyPage
