import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The server-safe rule (README): every module the package root reaches
// imports the atproto libraries for types only. A runtime import there would
// put the SDK in the server render and in any client chunk that imports the
// root statically, outside the lazy `bsky` chunk.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const SDK_DOORS = new Set(['moderation.ts', 'browser.ts', 'oauth.ts', 'syntax.ts'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return e.name.startsWith('__') ? [] : sourceFiles(path)
    return e.name.endsWith('.ts') ? [path] : []
  })
}

// A statement has no quote before its specifier, so `[^'"]` keeps one match
// inside one statement (a multi-line `import type {…}` still matches).
const FROM_IMPORT = /^(?:import|export)\s[^'"]*?from\s+['"]@atproto\/[^'"]+['"]/gm
// `import '@atproto/api'`: a side-effect import, no `from`.
const SIDE_EFFECT_IMPORT = /^import\s+['"]@atproto\/[^'"]+['"]/gm
// `import('@atproto/api')`: flagged too. A lazy load belongs in an SDK door,
// so the server-safe modules stay pure and the chunk rule has one place.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]@atproto\/[^'"]+['"]\s*\)/g

/** Each import statement or call whose specifier starts with `@atproto/`. */
function atprotoImports(source: string): string[] {
  return [FROM_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT].flatMap((re) => [...source.matchAll(re)].map((m) => m[0]))
}

/** The atproto imports that are not type-only. */
function runtimeImports(source: string): string[] {
  return atprotoImports(source).filter((s) => !/^(?:import|export)\s+type\s/.test(s))
}

describe('server-safe modules', () => {
  const files = sourceFiles(SRC).filter((f) => !SDK_DOORS.has(relative(SRC, f)))

  it('finds the modules it checks', () => {
    expect(files.map((f) => relative(SRC, f))).toEqual(expect.arrayContaining(['index.ts', 'facets.ts', 'map/post.ts']))
  })

  it.each(files.map((f) => [relative(SRC, f), f]))('%s imports atproto for types only', (_name, file) => {
    expect(runtimeImports(readFileSync(file, 'utf8'))).toEqual([])
  })

  it.each([
    ['A: a runtime import alone', "import { RichText } from '@atproto/api'\n"],
    ['B: a type import of another module, then a runtime one', "import type { X } from './x.js'\nimport { RichText } from '@atproto/api'\n"],
    ['C: a real file shape with a runtime line added', "import type { AppBskyFeedDefs } from '@atproto/api'\nimport type { Status } from '@beatzball/caribou-mastodon-client'\nimport type { MapContext } from './context.js'\nimport { RichText } from '@atproto/api'\n"],
    ['D: a side-effect import', "import '@atproto/api'\n"],
    ['E: a dynamic import', "export async function f() { return import('@atproto/api') }\n"],
    ['F: a double-quoted specifier', 'import { RichText } from "@atproto/api"\n'],
  ])('catches %s', (_name, source) => {
    expect(runtimeImports(source)).toHaveLength(1)
  })

  it('accepts a type import, also over several lines', () => {
    expect(atprotoImports("import type { RichText } from '@atproto/api'\n")).toHaveLength(1)
    expect(runtimeImports("import type { RichText } from '@atproto/api'\n")).toEqual([])
    expect(runtimeImports("import type {\n  A,\n  B,\n} from '@atproto/api'\n")).toEqual([])
  })
})
