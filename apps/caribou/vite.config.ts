import { defineConfig, type Plugin } from 'vite';

// Client-bundle stub for `unstorage` and `unstorage/drivers/fs`.
//
// Why this exists: page modules export `pageData = definePageData(fetcher)`
// whose fetcher transitively imports `server/lib/storage.ts` (for the SSRF
// registry check on the `caribou.instance` cookie). Vite/Rollup statically
// analyze the page module for the client bundle and pull `unstorage`'s
// filesystem driver into the client chunk graph. That driver imports
// `node:fs` / `node:path` named bindings (`dirname`, `resolve`) which Vite's
// browser-external shim does not provide, so the client build fails.
//
// Litro only invokes `pageData.fetcher` on the server; the client never
// reaches the code that would call into `unstorage`. This plugin satisfies
// the static analyzer with a no-op surface and throws loudly at runtime if
// any client code path somehow does reach it.
//
// The Nitro/server build does not consult this Vite config, so the server
// continues to receive the real `unstorage`.
function unstorageClientStubPlugin(): Plugin {
  const VIRTUAL_ID = '\0caribou:unstorage-client-stub';
  const STUB_SOURCE = `
function notInBrowser() {
  throw new Error(
    '[caribou] unstorage is server-only and must not be invoked in the browser bundle.'
  );
}
export function createStorage() { return notInBrowser(); }
const fsDriver = () => notInBrowser();
export default fsDriver;
`;
  return {
    name: 'caribou:unstorage-client-stub',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'unstorage' || id.startsWith('unstorage/drivers/')) {
        return VIRTUAL_ID;
      }
    },
    load(id) {
      if (id === VIRTUAL_ID) return STUB_SOURCE;
    },
  };
}

export default defineConfig({
  base: '/_litro/',
  plugins: [unstorageClientStubPlugin()],
  resolve: {
    conditions: ['browser', 'module', 'import', 'default'],
  },
  build: {
    outDir: 'dist/client',
    // No `<link rel="modulepreload">` for a route's chunks. Vite's preload
    // helper adds those tags and then calls `import()` for the same files;
    // in Firefox that pair sometimes leaves one request with no response —
    // it never reaches the server — and the page module never loads, so the
    // route never becomes interactive. Measured in Playwright's Firefox:
    // between 1 in 30 and 1 in 400 full page loads with preload on, 0 in
    // 1000 with it off. The cost is one extra round trip per import level
    // on a route's first visit.
    modulePreload: false,
    rollupOptions: {
      input: 'app.ts',
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
