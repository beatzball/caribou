import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findMastoUses } from './masto-boundary-scanner.js'

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

const SKIP_DIRS = new Set(['node_modules', 'dist', '.output', '.nitro', '.litro', 'coverage'])

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) tsFiles(join(dir, entry.name), out)
    } else if (/\.(c|m)?tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

describe('owned types boundary', () => {
  it('only the Mastodon client names masto types', () => {
    const offenders = ['apps', 'packages']
      .flatMap((d) => tsFiles(join(repoRoot, d)))
      .map((f) => relative(repoRoot, f).split(sep).join('/'))
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) => findMastoUses(f, readFileSync(join(repoRoot, f), 'utf8')).map((u) => `${f}:${u}`))
    expect(offenders).toEqual([])
  })
})
