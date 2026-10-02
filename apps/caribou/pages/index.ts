import { html } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage } from '@beatzball/litro/runtime'
import '../components/caribou-landing.js'

@customElement('page-index')
export class IndexPage extends LitroPage {
  override render() {
    return html`
      <caribou-landing></caribou-landing>
    `
  }
}

export default IndexPage
