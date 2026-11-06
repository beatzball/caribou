import { describe, expect, it } from 'vitest'
import { findMastoUses } from './masto-boundary-scanner.js'

// The sources below are built from parts so that this file itself names no
// masto module or namespace for a plain grep to find.
const M = 'mas' + 'to'
const NS = 'mastodon'

describe('findMastoUses', () => {
  it('finds nothing in a file that uses the owned types', () => {
    const src = `import type { Status } from '@beatzball/caribou-mastodon-client'\nexport type S = Status\n`
    expect(findMastoUses('a.ts', src)).toEqual([])
  })

  it('ignores the module name inside a plain string or comment', () => {
    const src = `// from '${M}'\nconst s = "import('${M}')"\nconst t = '${NS}.v1.Status'\n`
    expect(findMastoUses('a.ts', src)).toEqual([])
  })

  it.each([
    ['a bare import', `import type { ${NS} } from '${M}'`],
    ['a value import', `import { createRestAPIClient } from '${M}'`],
    ['a subpath import', `import type { Status } from '${M}/mastodon/entities/v1/status.js'`],
    ['a multiline from', `import type {\n  Status as S,\n} from\n  '${M}'`],
    ['a re-export', `export type { Status } from '${M}/mastodon/entities/v1/status.js'`],
    ['an export star', `export * from '${M}'`],
    ['a typeof import type', `export type X = typeof import('${M}')`],
    ['an import type with a member', `export type X = import('${M}').${NS}.v1.Status`],
    ['a dynamic import', `const m = await import('${M}')`],
    ['an import equals require', `import m = require('${M}')`],
    ['a require call', `const m = require('${M}/x.js')`],
    ['a module augmentation', `declare module '${M}' {}`],
  ])('finds %s', (_name, src) => {
    expect(findMastoUses('a.ts', src).length).toBeGreaterThan(0)
  })

  it('finds a re-export in a hand-written .d.ts', () => {
    const src = `export type { ${NS} } from '${M}'\n`
    expect(findMastoUses('shims.d.ts', src).length).toBeGreaterThan(0)
  })

  it('finds a masto namespace name in a type', () => {
    for (const v of ['v1', 'v2', 'rest']) {
      expect(findMastoUses('a.ts', `let s: ${NS}.${v}.Thing`).length).toBeGreaterThan(0)
    }
  })

  it('does not take a lookalike module for masto', () => {
    const src = `import x from '${M}don'\nimport y from '@scope/${M}'\n`
    expect(findMastoUses('a.ts', src)).toEqual([])
  })
})
