import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The server-safe rule (README): every module the package root reaches
// imports the atproto libraries for types only. A runtime import there would
// put the SDK in the server render and in any client chunk that imports the
// root statically, outside the lazy `bsky` chunk.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const SDK_DOORS = new Set(['moderation.ts', 'browser.ts'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return e.name.startsWith('__') ? [] : sourceFiles(path)
    return e.name.endsWith('.ts') ? [path] : []
  })
}

/** Each `import … from '<spec>'` statement whose specifier starts with `@atproto/`. */
function atprotoImports(source: string): string[] {
  return [...source.matchAll(/^(?:import|export)\s[^;]*?from\s+'(@atproto\/[^']+)'/gms)].map((m) => m[0])
}

describe('server-safe modules', () => {
  const files = sourceFiles(SRC).filter((f) => !SDK_DOORS.has(relative(SRC, f)))

  it('finds the modules it checks', () => {
    expect(files.map((f) => relative(SRC, f))).toEqual(expect.arrayContaining(['index.ts', 'facets.ts', 'map/post.ts']))
  })

  it.each(files.map((f) => [relative(SRC, f), f]))('%s imports atproto for types only', (_name, file) => {
    const runtime = atprotoImports(readFileSync(file, 'utf8')).filter((s) => !/^(?:import|export)\s+type\s/.test(s))
    expect(runtime).toEqual([])
  })

  it('catches a runtime import', () => {
    expect(atprotoImports("import { RichText } from '@atproto/api'\n")).toHaveLength(1)
    expect(atprotoImports("import type { RichText } from '@atproto/api'\n")).toHaveLength(1)
  })
})
