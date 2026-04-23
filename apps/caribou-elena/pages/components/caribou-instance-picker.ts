import { Elena, html } from '@elenajs/core'

export class CaribouInstancePicker extends Elena(HTMLElement) {
  static override tagName = 'caribou-instance-picker'
  private submitting = false
  private error: string | null = null

  private async onSubmit(e: Event) {
    e.preventDefault()
    if (this.submitting) return
    const form = e.currentTarget as HTMLFormElement
    const input = form.querySelector<HTMLInputElement>('input[name="server"]')!
    const server = input.value.trim()
    if (!server) return
    this.submitting = true
    this.error = null
    this.requestUpdate()
    try {
      const res = await fetch('/api/signin/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server }),
      })
      if (!res.ok) {
        this.error = 'Could not reach that instance. Check the spelling and try again.'
        return
      }
      const { authorizeUrl } = (await res.json()) as { authorizeUrl: string }
      location.href = authorizeUrl
    } catch {
      this.error = 'Network error — try again.'
    } finally {
      this.submitting = false
      this.requestUpdate()
    }
  }

  override render() {
    return html`
      <form @submit=${(e: Event) => this.onSubmit(e)}
            style="display:flex;flex-direction:column;gap:var(--space-3);max-width:400px;margin:0 auto;">
        <label for="server" style="color:var(--fg-1);">Your Mastodon instance</label>
        <input id="server" name="server" type="text" autocomplete="off"
               placeholder="mastodon.social"
               required
               style="padding:var(--space-3);border-radius:var(--radius-md);
                      border:1px solid var(--border);background:var(--bg-1);color:var(--fg-0);" />
        <button type="submit" ?disabled=${this.submitting}
                style="padding:var(--space-3);border-radius:var(--radius-md);
                       border:0;background:var(--accent);color:var(--accent-fg);cursor:pointer;">
          ${this.submitting ? 'Connecting…' : 'Sign in'}
        </button>
        ${this.error
          ? html`<p role="alert" style="color:var(--danger);margin:0;">${this.error}</p>`
          : ''}
      </form>
    `
  }
}
CaribouInstancePicker.define()
