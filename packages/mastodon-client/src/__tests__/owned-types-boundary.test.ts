import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findMastoUses, sourceFiles } from './masto-boundary-scanner.js'

// Screens, stores and SSR code name Caribou's own types (`Status`,
// `Account`, ...) from this package. Only the Mastodon client itself may
// name masto's types, because it maps them into Caribou's. A masto type
// named anywhere else would tie that code to Mastodon again.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

// The files that may name masto's types: the Mastodon client and its mapping.
const ALLOWED = new Set([
  'packages/mastodon-client/src/create-client.ts',
  'packages/mastodon-client/src/masto-mapping.ts',
])

describe('owned types boundary', () => {
  it('walks hand-written .d.ts files and skips build output', () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-walk-'))
    try {
      for (const dir of ['src', 'node_modules/pkg', 'dist', '.litro']) mkdirSync(join(root, dir), { recursive: true })
      for (const f of ['src/a.ts', 'src/shims.d.ts', 'src/b.mts', 'src/c.tsx', 'src/d.js',
        'node_modules/pkg/e.d.ts', 'dist/f.d.ts', '.litro/g.ts']) writeFileSync(join(root, f), '')
      const found = sourceFiles(root).map((f) => relative(root, f).split(sep).join('/')).sort()
      expect(found).toEqual(['src/a.ts', 'src/b.mts', 'src/c.tsx', 'src/shims.d.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('only the Mastodon client names masto types', () => {
    const offenders = ['apps', 'packages']
      .flatMap((d) => sourceFiles(join(repoRoot, d)))
      .map((f) => relative(repoRoot, f).split(sep).join('/'))
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) => findMastoUses(f, readFileSync(join(repoRoot, f), 'utf8')).map((u) => `${f}:${u}`))
    expect(offenders).toEqual([])
  })
})
