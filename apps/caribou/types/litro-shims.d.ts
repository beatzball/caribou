// Ambient declarations for Litro build-generated modules.
//
// At dev/build time the Litro page scanner writes:
//   - <rootDir>/routes.generated.ts          (consumed by app.ts)
//   - <rootDir>/server/stubs/page-manifest.ts (virtual module "#litro/page-manifest")
//
// Both paths are gitignored, so they don't exist on a clean clone. These
// ambient declarations let `tsc --noEmit` succeed before a build has run.
// When the real generated files exist, TypeScript resolves them directly
// and these declarations are shadowed — they're a typecheck-only safety net.

declare module '*/routes.generated.js' {
  import type { Route } from '@beatzball/litro/runtime'
  export const routes: Route[]
}

declare module '#litro/page-manifest' {
  import type { LitroRoute } from '@beatzball/litro'
  export const routes: LitroRoute[]
  export const pageModules: Record<string, Record<string, unknown>>
  const defaultExport: LitroRoute[]
  export default defaultExport
}
