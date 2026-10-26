import { LitElement, css, nothing, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { ICONS } from './_icons.js'
import { devWarn } from './_dev-warn.js'

export type IconName = keyof typeof ICONS

function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name)
}

// An icon is decoration: the control around it carries the accessible name.
// Size follows `font-size` (the SVG is 1em) and colour follows `color`.
// `filled` paints the outline's inside too, as a pressed toggle shows it;
// `--caribou-icon-fill` changes that paint (`none` keeps an icon that is
// all lines, like `repeat2`, as it was).
@customElement('caribou-icon')
export class CaribouIcon extends LitElement {
  static override styles = css`
    :host { display: inline-flex; line-height: 0; }
    :host([hidden]) { display: none; }
    :host([filled]) path { fill: var(--caribou-icon-fill, currentColor); }
  `

  @property() name = ''
  @property({ type: Boolean, reflect: true }) filled = false

  override connectedCallback() {
    super.connectedCallback()
    // The SVG inside is aria-hidden already; this hides the host too, so a
    // screen reader never lands on an empty element. Client only: the
    // server never runs connectedCallback, and host attributes are not part
    // of what hydration compares.
    this.setAttribute('aria-hidden', 'true')
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has('name') && this.name && !isIconName(this.name)) {
      devWarn(`<caribou-icon>: no icon named "${this.name}".`)
    }
  }

  override render() {
    return isIconName(this.name) ? ICONS[this.name] : nothing
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-icon': CaribouIcon }
}
