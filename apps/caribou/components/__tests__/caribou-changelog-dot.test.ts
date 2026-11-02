import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activeUserKey } from '@beatzball/caribou-state'
import { markChangelogSeen, startChangelogSeen } from '../_changelog-seen.js'
import '../caribou-changelog-dot.js'
import type { CaribouChangelogDot } from '../caribou-changelog-dot.js'

const ALICE = 'alice@example.social'
let stop: () => void = () => {}

async function mount(text = false) {
  const el = document.createElement('caribou-changelog-dot') as CaribouChangelogDot
  el.text = text
  document.body.append(el)
  while (!(await el.updateComplete)) { /* settle */ }
  return el
}

beforeEach(() => {
  localStorage.setItem(`caribou.prefs.${ALICE}`, JSON.stringify({ lastSeenChangelogVersion: '0.0.1' }))
  activeUserKey.value = ALICE
  stop = startChangelogSeen('0.11.0')
})

afterEach(() => {
  stop()
  document.body.replaceChildren()
  activeUserKey.value = null
  localStorage.clear()
})

describe('<caribou-changelog-dot>', () => {
  it('shows the dot after the first update when a newer version runs, hidden from assistive tech', async () => {
    const el = await mount()
    expect(el.hasAttribute('unread')).toBe(true)
    expect(el.shadowRoot!.querySelector('.dot')!.getAttribute('aria-hidden')).toBe('true')
    expect(el.shadowRoot!.textContent).toBe('')
  })

  it('with `text`, says ", new version" and draws no dot', async () => {
    const el = await mount(true)
    expect(el.shadowRoot!.querySelector('.dot')).toBeNull()
    expect(el.shadowRoot!.querySelector('.sr-only')!.textContent).toBe(', new version')
    markChangelogSeen()
    await el.updateComplete
    expect(el.shadowRoot!.textContent).toBe('')
  })

  it('goes away when the changelog is seen', async () => {
    const el = await mount()
    markChangelogSeen()
    await el.updateComplete
    expect(el.hasAttribute('unread')).toBe(false)
    expect(el.shadowRoot!.querySelector('.dot')).toBeNull()
  })

  it('shows nothing when signed out', async () => {
    activeUserKey.value = null
    const el = await mount()
    expect(el.shadowRoot!.querySelector('.dot')).toBeNull()
  })

  // The dot is drawn over its anchor, so showing it moves nothing.
  it('takes no room in the layout', () => {
    const css = (customElements.get('caribou-changelog-dot') as unknown as typeof CaribouChangelogDot)
      .styles!.toString()
    expect(css).toMatch(/:host\s*\{[^}]*position:\s*absolute/)
  })
})
