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
const notices = (el: { shadowRoot: ShadowRoot | null }) => [...el.shadowRoot!.querySelectorAll<HTMLElement>('.notice')]
const live = (el: { shadowRoot: ShadowRoot | null }) => el.shadowRoot!.querySelector<HTMLElement>('.announce')!
const B = 'did:plc:bobbbbbbbbbbbbbbbbbbbbbb@bsky'
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
    // Each button says which labeler it removes.
    expect(a!.querySelector('caribou-button')!.getAttribute('label')).toBe(`Remove labeler ${GONE}`)
    expect(b!.querySelector('caribou-button')!.getAttribute('label')).toBe(`Remove labeler ${OTHER}`)
  })

  it('has one live region, there from the first render, even with no notice', async () => {
    const el = await mount()
    expect(live(el).getAttribute('role')).toBe('status')
    expect(live(el).textContent).toBe('')
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
    expect(notices(el)[0]!.querySelector('.error')!.textContent).toBe('Could not remove the labeler. Try again.')
    // No alert nested inside the status.
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull()
    expect(notices(el)[0]!.getAttribute('role')).toBe('status')
    expect(notices(el)[0]!.querySelector('caribou-button')!.hasAttribute('loading')).toBe(false)
  })

  it('a removal says so in the live region and moves focus to the next Remove button', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE, OTHER] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(true)
    removeActiveGoneLabeler.mockImplementation(async () => {
      blueskyGoneLabelers.value = { userKey: KEY, dids: [OTHER] }
      return 'removed'
    })
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(live(el).textContent).toBe('Labeler removed.')
    expect(notices(el)).toHaveLength(1)
    expect(el.shadowRoot!.activeElement).toBe(notices(el)[0]!.querySelector('caribou-button'))
  })

  it('with no notice left, focus goes to main', async () => {
    const main = document.createElement('main')
    document.body.appendChild(main)
    const el = document.createElement('caribou-gone-labelers')
    main.appendChild(el)
    await el.updateComplete
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(true)
    removeActiveGoneLabeler.mockImplementation(async () => {
      blueskyGoneLabelers.value = { userKey: KEY, dids: [] }
      return 'absent'
    })
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(live(el).textContent).toBe('Labeler removed.')
    expect(document.activeElement).toBe(main)
  })

  it('a labeler that came back: the live region says nothing was removed', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(true)
    removeActiveGoneLabeler.mockResolvedValue('back')
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(live(el).textContent).toBe('The labeler is back. Nothing was removed.')
  })

  it('busy and failed belong to the account that started: A pending, then B', async () => {
    const el = await mount()
    blueskyGoneLabelers.value = { userKey: KEY, dids: [GONE] }
    await el.updateComplete
    confirmDialog.mockResolvedValue(true)
    let fail!: (e: unknown) => void
    removeActiveGoneLabeler.mockReturnValueOnce(new Promise((_r, j) => { fail = j }))
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(notices(el)[0]!.querySelector('caribou-button')!.hasAttribute('loading')).toBe(true)
    // Switch to B, who has the same labeler gone.
    activeUserKey.value = B as typeof activeUserKey.value
    blueskyGoneLabelers.value = { userKey: B, dids: [GONE] }
    await settle(el)
    expect(notices(el)[0]!.querySelector('caribou-button')!.hasAttribute('loading')).toBe(false)
    // A's failure lands: nothing on B's notice.
    fail(new Error('offline'))
    await settle(el)
    expect(notices(el)[0]!.querySelector('.error')).toBeNull()
    expect(live(el).textContent).toBe('')
    // B can start its own removal.
    removeActiveGoneLabeler.mockResolvedValueOnce('removed')
    notices(el)[0]!.querySelector('caribou-button')!.click()
    await settle(el)
    expect(removeActiveGoneLabeler).toHaveBeenCalledTimes(2)
  })
})
