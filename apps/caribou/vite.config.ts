import { defineConfig, type Plugin } from 'vite';

// Client-bundle stubs for server-only modules.
//
// Why this exists: page modules export `pageData = definePageData(fetcher)`,
// and Vite/Rollup statically analyze the page module for the client bundle.
// Litro only invokes `pageData.fetcher` on the server, so the client never
// reaches the code inside it — but the analyzer does not know that, and
// follows every import the fetcher makes:
//
// - `unstorage` / `unstorage/drivers/fs` (via `server/lib/storage.ts`, for
//   the SSRF registry check on the `caribou.instance` cookie). The fs driver
//   imports `node:fs` / `node:path` named bindings (`dirname`, `resolve`)
//   which Vite's browser-external shim does not provide, so without a stub
//   the client build fails outright.
// - `server/lib/sanitize.ts` (DOMPurify over jsdom). The pages reach it with
//   a dynamic `import()`, which keeps it out of the client's static graph,
//   so the browser never downloads it — but Vite still emits it as a lazy
//   chunk, `dist/client/assets/sanitize-*.js`, 2.7 MB of jsdom that ships
//   in the image for nothing and prints a page of "externalized for browser
//   compatibility" warnings on every build.
//
// Each stub satisfies the static analyzer with the module's export surface
// and throws loudly at runtime if any client code path somehow reaches it.
//
// The Nitro/server build is a separate Rollup run that does not consult this
// Vite config, and vitest reads `vitest.config.ts`, not this file — so the
// server and the unit tests keep the real modules. `litro dev` does load this
// file (`server/middleware/vite-dev.ts` creates an in-process Vite server
// from it), but that server only serves the browser's module graph; SSR and
// the `pageData` fetchers run from Nitro's own bundle, so they also keep the
// real modules in dev.
interface StubRule {
  /** Which import ids this stub replaces. */
  matches: (id: string) => boolean;
  /** The virtual module id; must start with `\0` so other plugins skip it. */
  virtualId: string;
  /** JavaScript source of the stub module. */
  source: string;
}

const NOT_IN_BROWSER = (what: string) => `
function notInBrowser() {
  throw new Error(
    '[caribou] ${what} is server-only and must not be invoked in the browser bundle.'
  );
}
`;

const STUB_RULES: StubRule[] = [
  {
    matches: (id) => id === 'unstorage' || id.startsWith('unstorage/drivers/'),
    virtualId: '\0caribou:unstorage-client-stub',
    source: `${NOT_IN_BROWSER('unstorage')}
export function createStorage() { return notInBrowser(); }
const fsDriver = () => notInBrowser();
export default fsDriver;
`,
  },
  {
    // Matches the relative specifier the pages write (`../server/lib/
    // sanitize.js`) as well as the resolved absolute path, in either
    // extension.
    matches: (id) => /(^|\/)server\/lib\/sanitize\.(js|ts)$/.test(id),
    virtualId: '\0caribou:sanitize-client-stub',
    source: `${NOT_IN_BROWSER('sanitize')}
export function sanitize() { return notInBrowser(); }
export function sanitizeStatus() { return notInBrowser(); }
export function sanitizeAccount() { return notInBrowser(); }
`,
  },
];

function serverOnlyClientStubPlugin(rules: StubRule[]): Plugin {
  return {
    name: 'caribou:server-only-client-stub',
    enforce: 'pre',
    resolveId(id) {
      const rule = rules.find((r) => r.matches(id));
      if (rule) return rule.virtualId;
    },
    load(id) {
      const rule = rules.find((r) => r.virtualId === id);
      if (rule) return rule.source;
    },
  };
}

export default defineConfig({
  base: '/_litro/',
  // Nitro serves public/ at the site root (`publicAssets` in nitro.config.ts).
  // Vite would also copy it into dist/client, which Nitro serves again under
  // /_litro/: a second copy of every icon in the image.
  publicDir: false,
  plugins: [serverOnlyClientStubPlugin(STUB_RULES)],
  resolve: {
    conditions: ['browser', 'module', 'import', 'default'],
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      input: 'app.ts',
      output: {
        entryFileNames: '[name].js',
        // Keep app.js a bootstrap that nothing imports. Left to itself, the
        // bundler puts lit-html (the hydration support needs it) and Vite's
        // preload helper into the entry, and every other chunk then imports
        // `../app.js`. The page loads the entry as `app.js?v=<build>` (see
        // server/lib/app-entry.ts), and a module under a second URL is a
        // second copy, so the chunks must not ask for it by its bare name.
        // lit-element stays out of this group: it must run after the
        // hydration support, which app.ts guarantees by importing the app
        // dynamically.
        codeSplitting: {
          groups: [{ name: 'boot', test: /lit-element-hydrate-support|[\\/]lit-html[\\/]|vite\/preload-helper/ }],
        },
      },
    },
  },
});
