import { describe, expect, it, vi } from 'vitest'
import type * as Api from '@atproto/api'

// The SDK throwing is the last gap: any future crash covers, never breaks the page.
vi.mock('@atproto/api', async (importOriginal) => {
  const real = await importOriginal<typeof Api>()
  const boom = () => { throw new TypeError('sdk crashed') }
  return { ...real, moderatePost: vi.fn(boom), moderateProfile: vi.fn(boom) }
})

const { LOGGED_OUT_PREFS, MODERATION_FAILED, isLabelerUnavailable, moderate } = await import('../moderation.js')
const { ALICE, author, post } = await import('../__fixtures__/moderation.js')

describe('moderate: the SDK throws', () => {
  it.each([
    ['post', { kind: 'post' as const, view: post() }],
    ['profile', { kind: 'profile' as const, view: author(ALICE) }],
  ])('a %s gets a cover in every context, no Show, no filter, one reason', (_, subject) => {
    const r = moderate(subject, undefined, LOGGED_OUT_PREFS, {})
    for (const ui of Object.values(r.contexts)) {
      expect(ui).toEqual({
        filter: false, blur: true, alert: false, inform: false, noOverride: true,
        reasons: [{ label: '!moderation-failed', source: '', name: MODERATION_FAILED }],
      })
      expect(isLabelerUnavailable(ui.reasons[0]!)).toBe(true)
    }
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
})
