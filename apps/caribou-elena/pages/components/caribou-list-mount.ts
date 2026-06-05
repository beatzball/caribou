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
  // `items` is a pre-rendered HTML string for the initial <li> children.
  // String prop avoids JSON-stringifying a large array through HTML attribute
  // encoding twice; the caller's renderStatusLiList already produces the
  // final markup.
  static override props = [{ name: 'items', reflect: false }]

  items: string = ''

  override render() {
    return html`<ul>${this.items ? unsafeHTML(this.items) : html``}</ul>`
  }

  get mountUl(): HTMLUListElement {
    return this.shadowRoot!.querySelector('ul')!
  }
}
CaribouListMount.define()
