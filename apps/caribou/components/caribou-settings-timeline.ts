import { LitElement, html } from 'lit'
import { customElement, state } from 'lit/decorators.js'
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

  override connectedCallback() {
    super.connectedCallback()
    const key = typeof window !== 'undefined' ? activeUserKey.peek() : null
    if (key) this.value = defaultTimelineOf(readPrefs(key))
  }

  private onChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value as DefaultTimeline
    const key = activeUserKey.peek()
    if (!key) return
    this.value = value
    updatePrefs(key, { defaultTimeline: value })
  }

  override render() {
    return html`
      <fieldset>
        <legend>Open after sign-in</legend>
        ${OPTIONS.map((o) => html`
          <label>
            <input type="radio" name="default-timeline" value=${o.value} .checked=${this.value === o.value} @change=${this.onChange} />
            ${o.label}
          </label>`)}
      </fieldset>
    `
  }
}
