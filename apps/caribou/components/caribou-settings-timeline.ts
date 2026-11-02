import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import {
  activeUserKey, defaultTimelineOf, readPrefs, updatePrefs, type DefaultTimeline,
} from '@beatzball/caribou-state'
import { choiceStyles } from './_settings-styles.js'

const OPTIONS: Array<{ value: DefaultTimeline; label: string }> = [
  { value: 'home', label: 'Home' },
  { value: 'local', label: 'Local' },
  { value: 'public', label: 'Public' },
]

// The timeline the app opens for the active account: after sign-in, and on
// `/` (the inline script in `server/lib/root-forward-head.ts` and
// `components/_root-forward.ts`).
@customElement('caribou-settings-timeline')
export class CaribouSettingsTimeline extends LitElement {
  static override styles = choiceStyles

  @state() private value: DefaultTimeline = 'home'
  @state() private status = ''

  override connectedCallback() {
    super.connectedCallback()
    const key = typeof window !== 'undefined' ? activeUserKey.peek() : null
    if (key) this.value = defaultTimelineOf(readPrefs(key))
  }

  private onChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value as DefaultTimeline
    const key = activeUserKey.peek()
    if (key && updatePrefs(key, { defaultTimeline: value })) {
      this.value = value
      this.status = ''
    } else {
      // The browser has checked the new radio; `live` puts the stored one back.
      this.value = key ? defaultTimelineOf(readPrefs(key)) : 'home'
      this.status = 'Not saved. This browser did not let Caribou store the setting.'
      this.requestUpdate()
    }
  }

  override render() {
    return html`
      <fieldset>
        <legend>Open after sign-in</legend>
        ${OPTIONS.map((o) => html`
          <label>
            <input type="radio" name="default-timeline" value=${o.value} .checked=${live(this.value === o.value)} @change=${this.onChange} />
            ${o.label}
          </label>`)}
      </fieldset>
      <p class="status" role="status">${this.status}</p>
    `
  }
}
