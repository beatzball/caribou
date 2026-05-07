import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getRequestURL } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import { getStorage } from '../server/lib/storage.js'
import type { ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-auth-required.js'
import './components/caribou-timeline.js'

export interface HomeData {
  kind: 'auth-required'
  shell: ShellInfo
}

export const pageData = definePageData<HomeData>(async (event) => {
  const origin = getRequestURL(event).origin
  const resolution = await resolveInstanceForRoute(event, {}, { storage: getStorage(), origin })
  return { kind: 'auth-required', shell: { instance: resolution.instance } }
})

export default class HomePage extends LitroPage {
  static override tagName = 'page-home'

  override connectedCallback() {
    super.connectedCallback?.()
    if (typeof window === 'undefined') return
    queueMicrotask(() => this.maybeSwapToTimeline())
  }

  private maybeSwapToTimeline() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    if (!meRaw || meRaw === 'null' || meRaw === '""') return
    const shell = this.querySelector('caribou-app-shell')
    if (!shell) return
    const real = document.createElement('caribou-timeline')
    real.setAttribute('kind', 'home')
    shell.replaceChildren(real)
  }

  override render() {
    const data = (this.serverData ?? { shell: { instance: null } }) as HomeData
    return html`
      <caribou-app-shell instance="${data.shell.instance ?? ''}">
        <caribou-auth-required
          label="/home shows your personal timeline. It requires a Mastodon access token, which Caribou keeps on your device."
        ></caribou-auth-required>
      </caribou-app-shell>
    `
  }
}
HomePage.define()
