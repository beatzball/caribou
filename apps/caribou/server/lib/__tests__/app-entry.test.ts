import { describe, it, expect } from 'vitest'
import { entryCacheControl } from '../app-entry.js'

const q = (search: string) => new URLSearchParams(search)

describe('entryCacheControl', () => {
  it("lets no browser keep this build's entry under another build's ?v=", () => {
    expect(entryCacheControl('/_litro/app.js', q('?v=0123456789ab'), 'aaaaaaaaaaaa')).toBe('no-store')
    expect(entryCacheControl('/_litro/app.js', q('?v='), 'aaaaaaaaaaaa')).toBe('no-store')
    expect(entryCacheControl('/_litro/app.js', q('?v=aaaaaaaaaaaa&v=0123456789ab'), 'aaaaaaaaaaaa')).toBe('no-store')
    expect(entryCacheControl('/_litro/app.js', q('?v=aaaaaaaaaaaa&x=1'), 'aaaaaaaaaaaa')).toBe('no-store')
    expect(entryCacheControl('/_litro/app.js', q('?V=0123456789ab'), 'aaaaaaaaaaaa')).toBe('no-store')
  })

  it("leaves this build's ?v= and the bare entry to the route rule", () => {
    expect(entryCacheControl('/_litro/app.js', q('?v=aaaaaaaaaaaa'), 'aaaaaaaaaaaa')).toBeUndefined()
    expect(entryCacheControl('/_litro/app.js', q(''), 'aaaaaaaaaaaa')).toBeUndefined()
  })

  it('touches no other path', () => {
    expect(entryCacheControl('/_litro/assets/app-main-abcdefgh.js', q('?v=x'), 'aaaaaaaaaaaa')).toBeUndefined()
    expect(entryCacheControl('/local', q('?v=x'), 'aaaaaaaaaaaa')).toBeUndefined()
  })

  it('does nothing without a client build', () => {
    expect(entryCacheControl('/_litro/app.js', q('?v=x'), undefined)).toBeUndefined()
  })
})
