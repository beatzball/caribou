import { Elena, html } from '@elenajs/core'

export class CaribouInstancePicker extends Elena(HTMLElement) {
  static override tagName = 'caribou-instance-picker'
  // Forward `submit` on the inner element up to this host; submit is a
  // non-bubbling, non-composed event so Elena re-dispatches it on the host.
  static override events = ['submit']

  private submitting = false
  private error: string | null = null

  /**
   * Elena wires `this.element.addEventListener('submit', this)` (see
   * `_delegateEvents` in @elenajs/core). That invokes `handleEvent` on
   * this host. The inner element is the <form>, so submit reaches us
   * with `currentTarget` = the form element.
   */
  handleEvent(e: Event) {
    if (e.type === 'submit') {
      void this.onSubmit(e)
    }
  }

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

  override updated() {
    // Boolean `disabled` must be assigned imperatively: Elena's template
    // engine only supports plain `attr="…"` interpolation, and any value
    // (including "") reads as truthy on `disabled`.
    const btn = this.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (btn) btn.disabled = this.submitting
  }

  override render() {
    return html`
      <form style="display:flex;flex-direction:column;gap:var(--space-3);max-width:400px;margin:0 auto;">
        <label for="server" style="color:var(--fg-1);">Your Mastodon instance</label>
        <input id="server" name="server" type="text" autocomplete="off"
               placeholder="mastodon.social"
               required
               style="padding:var(--space-3);border-radius:var(--radius-md);
                      border:1px solid var(--border);background:var(--bg-1);color:var(--fg-0);" />
        <button type="submit"
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
