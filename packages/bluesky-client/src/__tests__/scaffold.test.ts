import { describe, expect, it } from 'vitest'
import { renderFacets } from '../index.js'

// The scaffold (#177) fixes each module's signature. Each owner deletes its
// line here when the real code and its tests land.
describe('scaffold stubs', () => {
  const cases: [string, () => unknown][] = [
    ['#178', () => renderFacets('hi', undefined)],
  ]
  it.each(cases)('%s owns a stub that says TODO', (owner, call) => {
    expect(call).toThrow(`TODO(${owner})`)
  })
})
