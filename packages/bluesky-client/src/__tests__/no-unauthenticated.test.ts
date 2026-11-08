import { describe, expect, it } from 'vitest'
import { isProvenVisible } from '../no-unauthenticated.js'

// Spec 8.3, as an allow-list: signed out, an author shows only when its
// labels were read and none hides it.
describe('isProvenVisible', () => {
  const ok = { did: 'did:plc:alice', handle: 'alice.example.com', labels: [] }
  const hide = { src: 'did:plc:alice', uri: 'at://did:plc:alice/app.bsky.actor.profile/self', val: '!no-unauthenticated', cts: '2026-01-01T00:00:00.000Z' }

  it.each([
    ['an author with a labels array and no hiding label', ok, true],
    ['a negated hiding label', { ...ok, labels: [{ ...hide, neg: true }] }, true],
    ['the hiding label', { ...ok, labels: [hide] }, false],
    ['no labels key', { did: ok.did, handle: ok.handle }, false],
    ['labels null', { ...ok, labels: null }, false],
    ['labels not an array', { ...ok, labels: {} }, false],
    ['a label that is not an object', { ...ok, labels: ['x'] }, false],
    ['no handle', { did: ok.did, labels: [] }, false],
    ['no DID', { handle: ok.handle, labels: [] }, false],
    ['a DID that is not one', { ...ok, did: 'alice' }, false],
    ['undefined', undefined, false],
    ['null', null, false],
    ['a string', 'did:plc:alice', false],
  ] as const)('%s → %s', (_name, actor, visible) => {
    expect(isProvenVisible(actor)).toBe(visible)
  })
})
