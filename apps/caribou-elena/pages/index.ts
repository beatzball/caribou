import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import './components/caribou-landing.js'

export default class HomePage extends LitroPage {
  static override tagName = 'page-home'

  override render() {
    return html`
      <caribou-landing></caribou-landing>
    `
  }
}

HomePage.define()
