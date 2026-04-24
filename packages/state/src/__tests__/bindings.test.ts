import { signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { bindSignals } from '../bindings.js'

describe('bindSignals', () => {
  it('calls `update` on the instance when the read function\'s deps change', () => {
    const count = signal(0)
    const update = vi.fn()
    let reflected = 0
    const instance = { update }
    const dispose = bindSignals(instance, () => { reflected = count.value })
    expect(reflected).toBe(0)
    expect(update).toHaveBeenCalledTimes(1)
    count.value = 1
    expect(reflected).toBe(1)
    expect(update).toHaveBeenCalledTimes(2)
    dispose()
    count.value = 2
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('falls back to `requestUpdate` when `update` is absent', () => {
    const count = signal(0)
    const requestUpdate = vi.fn()
    const instance = { requestUpdate }
    const dispose = bindSignals(instance, () => { void count.value })
    count.value = 1
    expect(requestUpdate).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('is a no-op when neither method is present', () => {
    const count = signal(0)
    const instance = {}
    const dispose = bindSignals(instance, () => { void count.value })
    count.value = 1
    dispose()
  })
})
