import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import '../../components/caribou-bluesky-callback.js'

// The Bluesky callback (spec 5.5, step 4). The authorization server sends the
// reader here with the code in the URL fragment, so it never reaches the
// server. The server renders a shell only, and sends `no-store` and
// `no-referrer` (`server/routes/[...].ts`).
@customElement('page-signin-bluesky')
export class SigninBlueskyPage extends LitroPage {
  static override styles = [pageReset, css`:host { display: block; }`]

  override render() {
    return html`<caribou-bluesky-callback></caribou-bluesky-callback>`
  }
}

export default SigninBlueskyPage
