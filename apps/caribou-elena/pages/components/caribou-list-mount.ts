// Elena adapter. Lit/FAST adapters would need separate impls; the keyed reconciler depends only on the morph-opaque shadow boundary.
import { Elena, html, unsafeHTML } from '@elenajs/core'

const STYLES = `
  :host { display: block; }
  ul { list-style: none; margin: 0; padding: 0; }
`

export class CaribouListMount extends Elena(HTMLElement) {
  static override tagName = 'caribou-list-mount'
  static override shadow = 'open' as const
  static override styles = STYLES

  override render() {
    const itemsHtml = this.getAttribute('initial-items-html') ?? ''
    return html`<ul>${itemsHtml ? unsafeHTML(itemsHtml) : html``}</ul>`
  }

  get mountUl(): HTMLUListElement {
    return this.shadowRoot!.querySelector('ul')!
  }
}
CaribouListMount.define()
