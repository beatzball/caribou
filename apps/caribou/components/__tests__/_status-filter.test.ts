import { describe, expect, it } from 'vitest'
import type { mastodon } from 'masto'
import { filterVerdict, timelineFilterContext } from '../_status-filter.js'

type Action = 'warn' | 'hide' | 'blur'

function result(title: string, action: Action, context: string[]) {
  return {
    filter: { id: title, title, context, filterAction: action, keywords: [], statuses: [] },
    keywordMatches: ['x'], statusMatches: null,
  }
}

const post = (filtered?: unknown[], reblog?: unknown) =>
  ({ id: '1', filtered, reblog: reblog ?? null }) as unknown as mastodon.v1.Status

describe('filterVerdict', () => {
  it('is null for a status without `filtered` (an older server, or no token)', () => {
    expect(filterVerdict(post(), 'home')).toBeNull()
    expect(filterVerdict(post([]), 'home')).toBeNull()
  })

  it('is null when no context is given (bookmarks)', () => {
    expect(filterVerdict(post([result('Spoilers', 'hide', ['home'])]), null)).toBeNull()
  })

  it('applies a filter only in its own contexts', () => {
    const s = post([result('Spoilers', 'warn', ['home', 'thread'])])
    expect(filterVerdict(s, 'home')).toEqual({ action: 'warn', titles: ['Spoilers'] })
    expect(filterVerdict(s, 'thread')).toEqual({ action: 'warn', titles: ['Spoilers'] })
    expect(filterVerdict(s, 'public')).toBeNull()
    expect(filterVerdict(s, 'notifications')).toBeNull()
    expect(filterVerdict(s, 'account')).toBeNull()
  })

  it('hide wins over warn, and names every matching filter once', () => {
    const s = post([
      result('Spoilers', 'warn', ['home']),
      result('Politics', 'hide', ['home']),
      result('Spoilers', 'warn', ['home']),
    ])
    expect(filterVerdict(s, 'home')).toEqual({ action: 'hide', titles: ['Politics'] })
    const w = post([result('Spoilers', 'warn', ['home']), result('Sports', 'warn', ['home'])])
    expect(filterVerdict(w, 'home')).toEqual({ action: 'warn', titles: ['Spoilers', 'Sports'] })
  })

  it('treats blur, and any action this build does not know, as warn', () => {
    expect(filterVerdict(post([result('Gore', 'blur', ['home'])]), 'home'))
      .toEqual({ action: 'warn', titles: ['Gore'] })
    expect(filterVerdict(post([result('New', 'mystery' as Action, ['home'])]), 'home'))
      .toEqual({ action: 'warn', titles: ['New'] })
  })

  it('reads the boosted post too', () => {
    const boost = post(undefined, { id: '2', filtered: [result('Spoilers', 'hide', ['home'])] })
    expect(filterVerdict(boost, 'home')).toEqual({ action: 'hide', titles: ['Spoilers'] })
  })

  it('skips a malformed result instead of throwing', () => {
    expect(filterVerdict(post([{}, { filter: null }]), 'home')).toBeNull()
  })
})

describe('timelineFilterContext', () => {
  it('maps each timeline to its filter context', () => {
    expect(timelineFilterContext('home')).toBe('home')
    expect(timelineFilterContext('list')).toBe('home')
    expect(timelineFilterContext('local')).toBe('public')
    expect(timelineFilterContext('public')).toBe('public')
    expect(timelineFilterContext('hashtag')).toBe('public')
    expect(timelineFilterContext('bookmarks')).toBeNull()
  })
})
