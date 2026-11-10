import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey } from '@beatzball/caribou-state'

// A gone labeler (#238; app README, "A gone labeler"): the notice names it,
// asks before it removes, and sends one removal per click.

const removeActiveGoneLabeler = vi.fn()
const confirmDialog = vi.fn()
vi.mock('../_bluesky-session.js', () => ({ removeActiveGoneLabeler }))
vi.mock('../caribou-confirm-dialog.js', () => ({ confirmDialog }))

await import('../caribou-gone-labelers.js')
const { blueskyGoneLabelers } = await import('../_bluesky-moderation.js')

const KEY = 'did:plc:aliceaaaaaaaaaaaaaaaaaaa@bsky'
const GONE = 'did:plc:gonelabeleraaaaaaaaaaaaa'
const OTHER = 'did:plc:otherlabeleraaaaaaaaaaa'

async function mount() {
  const el = document.createElement('caribou-gone-labelers')
  document.body.appendChild(el)
  await el.updateComplete
  return el
}
const notices = (el: { shadowRoot: ShadowRoot | null }) => [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="status"]')]
const settle = async (el: { updateComplete: Promise<boolean> }) => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await el.updateComplete
}

beforeEach(() => {
  activeUserKey.value = KEY as typeof activeUserKey.value
  blueskyGoneLabelers.value = null
  removeActiveGoneLabeler.mockReset()
  confirmDialog.mockReset()
})
afterEach(() => {
  document.body.replaceChildren()
  activeUserKey.value = null
})

describe('<caribou-gone-labelers>', () => {
  it('shows nothing with no gone labeler, or for another account', async () => {
    const el = await mount()
    expect(notices(el)).toHaveLength(0)
    blueskyGoneLabelers.value = { userKey: KEY, dids: [] }
    await el.updateComplete
    expect(notices(el)).toHaveLength(0)
    blueskyGoneLabelers.value = { userKey: 'did:plc:bobbbbbbbbbbbbbbbbbbbbbb@bsky', dids: [GONE] }
    await el.updateComplete
    expect(notices(el)).toHaveLength(0)
  })

  it('names each gone labeler by its DID, with a Remove button', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE, OTHER] }
    await el.updateComplete
    const [a, b] = notices(el)
    expect(a!.textContent).toContain(GONE)
    expect(a!.textContent).toContain('Bluesky posts stay covered until you remove it.')
    expect(b!.textContent).toContain(OTHER)
    expect(a!.querySelector('caribou-button')!.textContent).toContain('Remove')
  })

  it('a no in the confirm sends nothing', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(false)
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove labeler?', confirmLabel: 'Remove' }))
    expect(confirmDialog.mock.calls[0]![0].message).toContain(GONE)
    expect(removeActiveGoneLabeler).not.toHaveBeenCalled()
  })

  it('a yes sends one removal for that DID, even on a second click', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(true)
    let finish!: (v: string) => void
    removeActiveGoneLabeler.mockReturnValue(new Promise((r) => { finish = r }))
    const button = () => notices(el)[0]!.querySelector('caribou-button')!
    button().click()
    button().click()
    await settle(el)
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(removeActiveGoneLabeler).toHaveBeenCalledTimes(1)
    expect(removeActiveGoneLabeler).toHaveBeenCalledWith(GONE)
    expect(button().hasAttribute('loading')).toBe(true)
    // The glue sets the reader again; the labeler is no longer gone.
    blueskyGoneLabelers.value = { userKey: KEY, dids: [] }
    finish('removed')
    await settle(el)
    expect(notices(el)).toHaveLength(0)
  })

  it('a failed removal keeps the notice and says so', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(true)
    removeActiveGoneLabeler.mockRejectedValue(new Error('offline'))
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(notices(el)).toHaveLength(1)
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe('Could not remove the labeler. Try again.')
    expect(notices(el)[0]!.querySelector('caribou-button')!.hasAttribute('loading')).toBe(false)
  })
})
