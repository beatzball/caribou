# Elena SSR adapter — DSD emission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Litro Elena SSR adapter so it emits Declarative Shadow DOM (`<template shadowrootmode>`) for shadow-DOM components and preserves the host's original light-DOM children for native `<slot>` composition. Land the fix via `pnpm patch @beatzball/litro@0.9.1` in this repo, verified by a new integration test that asserts the corrected SSR shape against the built production server.

**Architecture:** Branch `expandNestedCEs` and `renderElenaPage` on `ComponentClass.shadow`. When `'open'`/`'closed'`, emit `<tag attrs hydrated><template shadowrootmode="…"><style id="caribou-dsd-style">{flattened static styles}</style>{expanded render-template}</template>{expanded original children}</tag>` and do NOT set `instance.innerHTML`. When absent, keep today's light-DOM emission path unchanged.

**Tech Stack:** TypeScript, pnpm patch, Vitest (integration test that spawns the built Nitro server), Node `child_process.spawn` / `fetch`.

**Spec:** `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-design.md`

---

## File Structure

**Modified:**
- `patches/@beatzball__litro@0.9.1.patch` — new hunks added for `src/adapter/elena/index.ts` and `dist/adapter/elena/index.js`. The existing `path-to-route` hunks stay untouched.
- `apps/caribou-elena/tests/integration/` — new test file (see below).
- `.changeset/` — new entry describing the patch bump for `caribou-elena`.

**Created:**
- `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts` — boots the built server, curls four unauthenticated routes, asserts DSD presence + slotted children + no leaked light-DOM `<slot>`.
- `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md` — short PRD describing the same fix for `@beatzball/litro` upstream. Captured in this repo as the deliverable that hands off to Litro after Caribou validates the patch.

**Not touched:**
- `apps/caribou-elena/server/lib/render-shadow.ts` — unchanged. Continues to power hydration-parity unit tests.
- `apps/caribou-elena/pages/components/elena-shadow.ts` — unchanged. Its `caribou-dsd-style` sentinel check now matches the adapter's emission as well as the helper's.
- All component sources — they already carry the correct `static shadow` markers.

---

## Task 1: Write the failing integration test

**Files:**
- Create: `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = resolve(__dirname, '../../dist/server/server/index.mjs')

function getFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.on('error', rej)
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => res(port))
      } else {
        srv.close()
        rej(new Error('Failed to acquire free port'))
      }
    })
  })
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`)
}

let server: ChildProcess | undefined
let baseUrl = ''

beforeAll(async () => {
  if (!existsSync(SERVER_PATH)) {
    throw new Error(
      `Server bundle not found at ${SERVER_PATH}.\n` +
        `Run \`pnpm --filter caribou-elena build\` before running this test.`,
    )
  }
  const port = await getFreePort()
  baseUrl = `http://localhost:${port}`
  server = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Surface server errors so a crash during ready-wait shows up clearly.
  server.stderr?.on('data', (chunk) => {
    process.stderr.write(`[caribou-elena server] ${chunk}`)
  })
  await waitForReady(`${baseUrl}/api/health`, 15_000)
}, 30_000)

afterAll(() => {
  if (server && !server.killed) server.kill('SIGTERM')
})

const ROUTES = ['/local', '/public', '/home', '/@me'] as const

describe.each(ROUTES)('SSR slot composition: %s', (route) => {
  let body = ''

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}${route}`)
    expect(res.status, `${route} should return 200`).toBe(200)
    body = await res.text()
  })

  it('emits at least one <template shadowrootmode> wrapper', () => {
    expect(body).toMatch(/<template shadowrootmode="(open|closed)">/)
  })

  it('places <caribou-auth-required> inside <caribou-app-shell> as a light-DOM child', () => {
    const shellMatch = body.match(/<caribou-app-shell\b[^>]*>([\s\S]*?)<\/caribou-app-shell>/)
    expect(shellMatch, 'response should contain <caribou-app-shell>').not.toBeNull()
    // Strip the shadow-root template; what remains is the host's light-DOM children.
    const lightChildren = shellMatch![1].replace(
      /<template shadowrootmode="[^"]*">[\s\S]*?<\/template>/g,
      '',
    )
    expect(lightChildren).toContain('<caribou-auth-required')
  })

  it('has no literal <slot></slot> outside a <template shadowrootmode>', () => {
    const stripped = body.replace(
      /<template shadowrootmode="[^"]*">[\s\S]*?<\/template>/g,
      '',
    )
    expect(stripped).not.toMatch(/<slot(?:\s[^>]*)?><\/slot>/)
  })

  it('__litro_data__ has kind="auth-required" when no instance cookie is set', () => {
    const match = body.match(
      /<script type="application\/json" id="__litro_data__">([^<]+)<\/script>/,
    )
    expect(match, 'response should contain __litro_data__').not.toBeNull()
    const data = JSON.parse(match![1]) as { kind: string }
    expect(data.kind).toBe('auth-required')
  })
})
```

- [ ] **Step 2: Commit the test (red — will not pass yet)**

```bash
git add apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts
git commit -m "test(caribou-elena): SSR slot composition integration test (currently red)"
```

---

## Task 2: Verify the test fails against today's adapter

**Files:** none modified — verification only.

- [ ] **Step 1: Build Caribou-elena**

Run: `pnpm --filter caribou-elena build`
Expected: `dist/server/server/index.mjs` is produced. Build completes; existing tests are not run by this command.

- [ ] **Step 2: Run the new test against the unpatched adapter**

Run: `pnpm --filter caribou-elena vitest run tests/integration/ssr-slot-composition.test.ts`
Expected: all four routes fail their first assertion (`<template shadowrootmode>` regex does not match) and several follow-on assertions (slotted child missing, literal `<slot></slot>` present in light DOM). At least 8 failed assertions across the matrix. The `__litro_data__` assertion may pass on its own — that branch is correct today; the bug is in HTML emission.

This is the red gate that proves the test exercises the bug. Do not proceed to Task 3 if the test passes against the unpatched build.

---

## Task 3: Patch the adapter via `pnpm patch`

**Files:**
- Modify: `patches/@beatzball__litro@0.9.1.patch` (regenerated by `pnpm patch-commit`)
- Indirectly modify: `pnpm-workspace.yaml` — only if pnpm rewrites it (the entry already exists; no-op expected)

- [ ] **Step 1: Open a patch workspace**

Run: `pnpm patch @beatzball/litro@0.9.1`
Expected output: a temp directory path and a hint to run `pnpm patch-commit <path>` when done. Capture the path; it will look something like `/tmp/<hash>/node_modules/@beatzball/litro` or `/private/var/folders/.../patch-...`.

Assign to a shell variable for the rest of this task:

```bash
PATCH_DIR=$(pnpm patch @beatzball/litro@0.9.1 2>&1 | grep -Eo '/[^[:space:]]+/@beatzball/litro')
# Verify
ls "$PATCH_DIR/src/adapter/elena/index.ts" "$PATCH_DIR/dist/adapter/elena/index.js"
```

Note: pnpm prints the path; the `grep` extraction above works on the default human-readable output. If your shell mangles it, just copy the path manually from the `pnpm patch` output and assign it explicitly:

```bash
PATCH_DIR=/the/path/printed/by/pnpm/patch
```

- [ ] **Step 2: Patch `src/adapter/elena/index.ts` (TypeScript source)**

Edit `$PATCH_DIR/src/adapter/elena/index.ts`. Two changes:

**Change A** — add the style-flatten helper and the DSD sentinel constant. Insert these lines immediately after the existing `decodeEntities` function (after line ~144 of the source, just before the `CE_TAG_RE` declaration):

```typescript
/** Sentinel id used by adoption-suppression contracts in DSD-aware Elena bases. */
const DSD_SENTINEL_STYLE_ID = 'caribou-dsd-style';

/**
 * Flatten a component's `static styles` field to a single string for DSD inlining.
 * Accepts string | string[] | (string | CSSStyleSheet)[]. CSSStyleSheet entries
 * are skipped — no constructable-stylesheet platform on the SSR side. Empty
 * string is a valid return value; callers still emit the sentinel <style> element.
 */
function flattenStyles(styles: unknown): string {
  if (styles == null) return '';
  const list = Array.isArray(styles) ? styles : [styles];
  return list.filter((s): s is string => typeof s === 'string').join('\n');
}
```

**Change B** — replace `expandNestedCEs` to branch on `ComponentClass.shadow`. Replace the entire existing function body (lines ~168-186 of source) with:

```typescript
function expandNestedCEs(html: string, ceMap: Map<string, Function>, depth = 0): string {
  if (depth > 10) return html; // Guard against infinite recursion.
  return html.replace(CE_TAG_RE, (match, tag, attrStr, childContent) => {
    // Skip already-expanded CEs (have hydrated attribute from a prior pass).
    if (attrStr && /\bhydrated\b/.test(attrStr)) return match;
    const ComponentClass = ceMap.get(tag);
    if (!ComponentClass) return match; // Not registered — leave as-is.
    // Expand any nested CEs in the children (bottom-up) — used by both branches.
    const expandedChildren = childContent
      ? expandNestedCEs(childContent, ceMap, depth + 1)
      : undefined;
    const attrs = parseAttrs(attrStr || '');
    const shadow = (ComponentClass as unknown as { shadow?: 'open' | 'closed' }).shadow;
    if (shadow === 'open' || shadow === 'closed') {
      // Shadow-DOM component → emit Declarative Shadow DOM and preserve the
      // host's original light-DOM children so the browser composes <slot>
      // natively. Do NOT pass children as instance.innerHTML — slot composition
      // is the contract; reading this.innerHTML in a shadow render() is incoherent.
      const innerHTML = renderComponent(ComponentClass, attrs, undefined, undefined);
      const expandedInner = expandNestedCEs(innerHTML, ceMap, depth + 1);
      const styles = flattenStyles((ComponentClass as unknown as { styles?: unknown }).styles);
      const dsd =
        `<template shadowrootmode="${shadow}">` +
        `<style id="${DSD_SENTINEL_STYLE_ID}">${styles}</style>` +
        expandedInner +
        `</template>`;
      const lightChildren = expandedChildren ?? '';
      return `<${tag}${attrStr || ''} hydrated>${dsd}${lightChildren}</${tag}>`;
    }
    // Light-DOM component → existing behavior: render template replaces children,
    // original children pass through as instance.innerHTML for wrapper components.
    const innerHTML = renderComponent(ComponentClass, attrs, undefined, expandedChildren);
    if (!innerHTML) return match;
    const expanded = expandNestedCEs(innerHTML, ceMap, depth + 1);
    return `<${tag}${attrStr || ''} hydrated>${expanded}</${tag}>`;
  });
}
```

**Change C** — extend `renderElenaPage` to branch on shadow for the page entry. Replace the existing function (lines ~198-222) with:

```typescript
async function* renderElenaPage(
  tag: string,
  serverData: unknown,
): AsyncIterable<string> {
  const ceMap: Map<string, Function> | undefined = (globalThis as any).__litro_elena_ce_map__;
  if (!ceMap) {
    throw new Error(
      '[litro:elena] Component registry not found. ' +
        'Ensure LITRO_ADAPTER=elena is set and the manifest preamble ran.',
    );
  }

  const ComponentClass = ceMap.get(tag);
  if (!ComponentClass) {
    throw new Error(
      `[litro:elena] Component <${tag}> not found in registry. ` +
        `Registered: ${[...ceMap.keys()].join(', ')}`,
    );
  }

  const shadow = (ComponentClass as unknown as { shadow?: 'open' | 'closed' }).shadow;
  const innerHTML = renderComponent(ComponentClass, {}, serverData);
  const expanded = expandNestedCEs(innerHTML, ceMap);
  if (shadow === 'open' || shadow === 'closed') {
    const styles = flattenStyles((ComponentClass as unknown as { styles?: unknown }).styles);
    const dsd =
      `<template shadowrootmode="${shadow}">` +
      `<style id="${DSD_SENTINEL_STYLE_ID}">${styles}</style>` +
      expanded +
      `</template>`;
    yield `<${tag} hydrated>${dsd}</${tag}>`;
    return;
  }
  yield `<${tag} hydrated>${expanded}</${tag}>`;
}
```

- [ ] **Step 3: Patch `dist/adapter/elena/index.js` (compiled output)**

Apply the same three changes to `$PATCH_DIR/dist/adapter/elena/index.js`. The compiled file mirrors the source but without type annotations and with a few stylistic differences (TS compiler output). The structure-by-structure changes:

**Change A — add helper + constant** after the `decodeEntities` function (~line 143 of dist):

```javascript
/** Sentinel id used by adoption-suppression contracts in DSD-aware Elena bases. */
const DSD_SENTINEL_STYLE_ID = 'caribou-dsd-style';
/**
 * Flatten a component's `static styles` field to a single string for DSD inlining.
 */
function flattenStyles(styles) {
    if (styles == null) return '';
    const list = Array.isArray(styles) ? styles : [styles];
    return list.filter((s) => typeof s === 'string').join('\n');
}
```

**Change B — replace `expandNestedCEs`** (lines ~164-186 of dist):

```javascript
function expandNestedCEs(html, ceMap, depth = 0) {
    if (depth > 10)
        return html;
    return html.replace(CE_TAG_RE, (match, tag, attrStr, childContent) => {
        if (attrStr && /\bhydrated\b/.test(attrStr))
            return match;
        const ComponentClass = ceMap.get(tag);
        if (!ComponentClass)
            return match;
        const expandedChildren = childContent
            ? expandNestedCEs(childContent, ceMap, depth + 1)
            : undefined;
        const attrs = parseAttrs(attrStr || '');
        const shadow = ComponentClass.shadow;
        if (shadow === 'open' || shadow === 'closed') {
            const innerHTML = renderComponent(ComponentClass, attrs, undefined, undefined);
            const expandedInner = expandNestedCEs(innerHTML, ceMap, depth + 1);
            const styles = flattenStyles(ComponentClass.styles);
            const dsd =
                `<template shadowrootmode="${shadow}">` +
                `<style id="${DSD_SENTINEL_STYLE_ID}">${styles}</style>` +
                expandedInner +
                `</template>`;
            const lightChildren = expandedChildren ?? '';
            return `<${tag}${attrStr || ''} hydrated>${dsd}${lightChildren}</${tag}>`;
        }
        const innerHTML = renderComponent(ComponentClass, attrs, undefined, expandedChildren);
        if (!innerHTML)
            return match;
        const expanded = expandNestedCEs(innerHTML, ceMap, depth + 1);
        return `<${tag}${attrStr || ''} hydrated>${expanded}</${tag}>`;
    });
}
```

**Change C — replace `renderElenaPage`** (lines ~197-212 of dist):

```javascript
async function* renderElenaPage(tag, serverData) {
    const ceMap = globalThis.__litro_elena_ce_map__;
    if (!ceMap) {
        throw new Error('[litro:elena] Component registry not found. ' +
            'Ensure LITRO_ADAPTER=elena is set and the manifest preamble ran.');
    }
    const ComponentClass = ceMap.get(tag);
    if (!ComponentClass) {
        throw new Error(`[litro:elena] Component <${tag}> not found in registry. ` +
            `Registered: ${[...ceMap.keys()].join(', ')}`);
    }
    const shadow = ComponentClass.shadow;
    const innerHTML = renderComponent(ComponentClass, {}, serverData);
    const expanded = expandNestedCEs(innerHTML, ceMap);
    if (shadow === 'open' || shadow === 'closed') {
        const styles = flattenStyles(ComponentClass.styles);
        const dsd =
            `<template shadowrootmode="${shadow}">` +
            `<style id="${DSD_SENTINEL_STYLE_ID}">${styles}</style>` +
            expanded +
            `</template>`;
        yield `<${tag} hydrated>${dsd}</${tag}>`;
        return;
    }
    yield `<${tag} hydrated>${expanded}</${tag}>`;
}
```

- [ ] **Step 4: Commit the patch**

Run: `pnpm patch-commit "$PATCH_DIR"`
Expected: pnpm regenerates `patches/@beatzball__litro@0.9.1.patch` to include the new hunks alongside the existing `path-to-route` hunks, and pnpm reinstalls the dependency under a new patch-hash directory in `node_modules/.pnpm/`.

- [ ] **Step 5: Sanity-check the patch contents**

Run: `grep -E '^diff --git' patches/@beatzball__litro@0.9.1.patch`
Expected:

```
diff --git a/dist/adapter/elena/index.js b/dist/adapter/elena/index.js
diff --git a/dist/plugins/path-to-route.js b/dist/plugins/path-to-route.js
diff --git a/src/adapter/elena/index.ts b/src/adapter/elena/index.ts
diff --git a/src/plugins/path-to-route.ts b/src/plugins/path-to-route.ts
```

Four hunks total: two pre-existing (`path-to-route`), two new (`adapter/elena`). If the elena hunks are missing or extra files are present, re-run `pnpm patch @beatzball/litro@0.9.1` and re-apply the changes from Steps 2-3.

- [ ] **Step 6: Stage and commit the patch + workspace updates**

```bash
git add patches/@beatzball__litro@0.9.1.patch pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "fix(litro-patch): emit DSD for shadow-DOM Elena components in SSR

The adapter's expandNestedCEs and renderElenaPage now branch on
ComponentClass.shadow. Shadow-DOM components produce <template
shadowrootmode> + inline <style id=caribou-dsd-style> + render template,
with the host's original light-DOM children preserved verbatim so the
browser composes <slot> natively. Light-DOM components keep the existing
emission path unchanged.

Patches @beatzball/litro@0.9.1 in Caribou's patches/ until the same fix
lands upstream — see docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md."
```

---

## Task 4: Rebuild and verify the test passes

**Files:** none modified — verification only.

- [ ] **Step 1: Clean and rebuild**

Run: `pnpm --filter caribou-elena build`
Expected: build succeeds. The patched `@beatzball/litro` is now consumed automatically; pnpm's patched-dependency machinery wired it in during Task 3 Step 4.

- [ ] **Step 2: Run the SSR integration test**

Run: `pnpm --filter caribou-elena vitest run tests/integration/ssr-slot-composition.test.ts`
Expected: green. All four routes pass all four assertions (16 passing assertions total across the matrix).

If a route's assertion fails, inspect the rendered HTML directly:

```bash
PORT=4123 node apps/caribou-elena/dist/server/server/index.mjs &
sleep 4
curl -s http://localhost:4123/local | python3 -c 'import sys, html; print(html.unescape(sys.stdin.read()))' | grep -E 'shadowrootmode|<slot|caribou-auth-required'
kill %1
```

---

## Task 5: Run the full test + build matrix

**Files:** none modified — verification only.

- [ ] **Step 1: Run all Caribou tests**

Run: `pnpm -r test`
Expected: every package's test suite passes, including:

- `apps/caribou-elena` Vitest (unit + integration, **including the new test**)
- `apps/caribou-elena` hydration-parity tests (unaffected — they exercise `renderShadowComponentToString` directly, which this patch does not modify)
- `packages/elena-morph-spec` morph contract tests
- All other workspace packages

- [ ] **Step 2: Run the full build**

Run: `pnpm -r build`
Expected: every package builds. `apps/caribou-elena/dist/server/server/index.mjs` is regenerated and reflects the patched adapter.

- [ ] **Step 3: Confirm Playwright e2e suite is unaffected (smoke run)**

Run: `pnpm --filter caribou-elena test:e2e -- --project=chromium`
Expected: existing e2e specs pass. The Playwright webServer auto-builds and reuses the existing build. If any spec asserts on the pre-fix HTML shape (literal `<slot>`, missing DSD), update it as part of this task — but as of this plan no e2e specs do so; this run is a regression check.

---

## Task 6: Manual smoke + changeset

**Files:**
- Create: `.changeset/elena-ssr-dsd-emission.md`

- [ ] **Step 1: Curl-driven manual verification**

```bash
PORT=4123 node apps/caribou-elena/dist/server/server/index.mjs &
sleep 4
echo "=== shadowrootmode count (expect > 0) ==="
curl -s http://localhost:4123/local | grep -c 'shadowrootmode'
echo "=== light-DOM <slot></slot> count (expect 0) ==="
curl -s http://localhost:4123/local \
  | python3 -c 'import sys, re; s = sys.stdin.read(); s = re.sub(r"<template shadowrootmode=\"[^\"]*\">.*?</template>", "", s, flags=re.S); print(len(re.findall(r"<slot(?:\s[^>]*)?></slot>", s)))'
echo "=== caribou-auth-required present (expect: line shown) ==="
curl -s http://localhost:4123/local | grep -o '<caribou-auth-required[^>]*>' | head -1
kill %1
```

Expected: `shadowrootmode` count > 0, residual light-DOM `<slot>` count is 0, `<caribou-auth-required …>` line is printed. Repeat for `/public`, `/home`, `/@me` if any of them surprise you on the first sweep.

- [ ] **Step 2: Write the changeset**

Create `.changeset/elena-ssr-dsd-emission.md`:

```markdown
---
"caribou-elena": patch
---

Patch `@beatzball/litro@0.9.1` so the Elena SSR adapter emits Declarative Shadow DOM for shadow-DOM custom elements and preserves the host's original light-DOM children for native `<slot>` composition. Previously the adapter emitted the host's render template as light-DOM children and dropped the page's slotted content, leaving a literal `<slot></slot>` in the response and an empty pre-hydration shell on every cross-route navigation. The patch lives in `patches/@beatzball__litro@0.9.1.patch`; the same fix is queued for upstream submission (see `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md`).

User-visible: pre-hydration HTML for `/local`, `/public`, `/home`, `/@me`, profile, and thread routes now shows the route's actual content (or `<caribou-auth-required>` placeholder) instead of a bare shell. Plan 3 §12.6's byte-equal hydration parity guarantee becomes operative in production rather than just in the isolated helper.
```

- [ ] **Step 3: Commit the changeset**

```bash
git add .changeset/elena-ssr-dsd-emission.md
git commit -m "chore(caribou-elena): changeset for Elena SSR DSD emission patch"
```

---

## Task 7: Write the upstream PRD

**Files:**
- Create: `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md`

- [ ] **Step 1: Write the PRD**

Create `docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md`:

```markdown
---
title: Upstream PRD — Elena SSR adapter DSD emission for shadow-DOM components
date: 2026-05-12
status: ready to hand to upstream
target-repo: ~/w/beatzball/litro
target-file: packages/framework/src/adapter/elena/index.ts
companion-patch: ~/w/beatzball/caribou/patches/@beatzball__litro@0.9.1.patch (hunks for adapter/elena)
verified-by: ~/w/beatzball/caribou/apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts
---

# Elena SSR adapter — DSD emission for shadow-DOM custom elements (upstream PRD)

## Problem

The Elena framework adapter's SSR pipeline currently does flat-replacement recursive rendering for every custom element it encounters. For shadow-DOM components (`static shadow = 'open' | 'closed'`), this:

- Emits the host's render template as the host's light-DOM children.
- Discards the page's original children (the actual slotted content).
- Leaves a literal `<slot></slot>` element in the light DOM that the browser cannot compose.

The visible result: any page that wraps content in a shadow-DOM shell component renders an empty shell pre-hydration. Post-hydration the client's morph fixes it, so the bug is invisible in JS-enabled browsers — but no-JS readers see only the shell, and cross-route navigations show a brief flicker as the wrong DOM is replaced.

Affected adapter: `packages/framework/src/adapter/elena/index.ts`, functions `expandNestedCEs` and `renderElenaPage`.

## Reproduction

Any Litro app that mounts a shadow-DOM Elena component as a wrapper exhibits this. Caribou's reproduction (smallest end-to-end):

1. Define a shadow-DOM component with a `<slot>` in its render template:

```ts
class AppShell extends Elena(HTMLElement) {
  static tagName = 'app-shell'
  static shadow = 'open' as const
  static styles = `:host { display: block; } main { padding: 1rem; }`
  render() { return html`<main><slot></slot></main>` }
}
AppShell.define()
```

2. Define a page that renders the shell with a child:

```ts
render() { return html`<app-shell><p>hello</p></app-shell>` }
```

3. Curl the route. Expected (after fix):

```html
<app-shell hydrated>
  <template shadowrootmode="open">
    <style id="caribou-dsd-style">:host { display: block; } main { padding: 1rem; }</style>
    <main><slot></slot></main>
  </template>
  <p>hello</p>
</app-shell>
```

Actual (today):

```html
<app-shell hydrated><main><slot></slot></main></app-shell>
```

## Proposed change

Branch `expandNestedCEs` and `renderElenaPage` on `ComponentClass.shadow`.

**Shadow-DOM emission** (`shadow === 'open' | 'closed'`):

```
<tag attrs hydrated>
  <template shadowrootmode="{shadow}">
    <style id="caribou-dsd-style">{flattened static styles}</style>
    {expanded render template}
  </template>
  {expanded original children}
</tag>
```

Original children are passed through recursive CE expansion and emitted as light-DOM children. `instance.innerHTML` is **not** set — slot composition is the contract; reading `this.innerHTML` from a shadow render() is incoherent.

**Light-DOM emission** (no `shadow`): unchanged from today's code path. Original children are passed as `instance.innerHTML` for wrapper components; render template replaces children in output.

**Style flattening**: `static styles` accepts `string | string[] | (string | CSSStyleSheet)[]`. Strings join with `\n`; `CSSStyleSheet` entries are dropped (no constructable-stylesheet platform server-side). Always emit `<style id="caribou-dsd-style">…</style>` even when empty — the sentinel id is the contract for downstream adoption-suppression bases.

**Sentinel constant**: `DSD_SENTINEL_STYLE_ID = 'caribou-dsd-style'`. The literal `caribou-` prefix is a contract chosen by downstream Caribou. If a different name fits Litro's neutrality posture, use `litro-dsd-style` or expose it as configurable via `FrameworkAdapter`. The Caribou patch can adjust on rebase.

## Concrete patch

See the Caribou patch hunks at `patches/@beatzball__litro@0.9.1.patch` (the `adapter/elena/index.{js,ts}` hunks). The change is ~60 lines added to `index.ts` plus the corresponding `dist/` regeneration.

## Tests Litro should add

A minimal unit test inside `packages/framework/test/` (or wherever the adapter tests live) covering:

1. **Light-DOM component**: `expandNestedCEs` of `<my-light><p>x</p></my-light>` where `MyLight` has no `static shadow` produces `<my-light hydrated>{render-output}</my-light>` (existing behavior).
2. **Shadow-DOM component, no styles**: `expandNestedCEs` of `<my-shell><p>x</p></my-shell>` where `MyShell` has `static shadow = 'open'` and no `static styles` produces `<my-shell hydrated><template shadowrootmode="open"><style id="caribou-dsd-style"></style>{render-output}</template><p>x</p></my-shell>`.
3. **Shadow-DOM component with array styles**: same as (2) but with `static styles = ['a { }', 'b { }']` produces `<style id="caribou-dsd-style">a { }\nb { }</style>`.
4. **Closed shadow**: `static shadow = 'closed'` produces `shadowrootmode="closed"`.
5. **Render throws**: shadow-DOM host still emits its tag + empty DSD template + original children (graceful degradation).
6. **Recursion guard**: deeply nested CEs stop expanding at depth 10 (existing).

## Migration notes for downstream consumers

The change is observable in the right direction. Consumers see:

- `<template shadowrootmode>` markers appear in SSR output for shadow-DOM components.
- Slotted children now compose natively pre-hydration (previously broken).
- Light-DOM components: byte-identical output to before.

No consumer code should need to change. Snapshot tests that assert on the literal pre-fix HTML shape (`<my-shell>{render-template}</my-shell>` with no children) will need updating — these tests were asserting on the bug.

## Browser compatibility

DSD is supported natively in Chromium 90+, Safari 16.4+, Firefox 123+ (all current at the time of this PRD). For consumers targeting older browsers, a small polyfill (the `<template>` walker described in the WHATWG proposal) is well-documented; Litro's `getHeadScripts` could expose an opt-in flag (`needsDSDPolyfill`) — currently set to `false` on Elena's adapter.

## Out of scope (for this upstream PR)

- The `caribou-dsd-style` literal sentinel id — adjustable per maintainer preference.
- Refactoring the adapter's internal helpers (`renderComponent`, `expandNestedCEs`) into a cleaner shape. The fix is intentionally minimal-diff for review safety.
- DSD polyfill emission. The adapter's `needsDSDPolyfill: false` flag stays as-is.
```

- [ ] **Step 2: Commit the PRD**

```bash
git add docs/superpowers/specs/2026-05-12-elena-ssr-dsd-emission-upstream-prd.md
git commit -m "docs: upstream PRD for Litro Elena SSR DSD emission

Hand-off document for the same fix to land in @beatzball/litro upstream
after Caribou validates the patch in production. Captures the bug, the
proposed change, the test surface Litro should add, and the migration
posture. References the Caribou patch hunks as the concrete diff."
```

---

## Self-Review

Spec coverage:
- §0 Goal → Tasks 1-7 collectively
- §1 Scope → Task 3 (patch), Task 1+4 (integration test), Task 7 (PRD)
- §2 Bug verified → Task 2 (failing test), Task 6 (manual smoke)
- §3 Architecture → Task 3 Steps 2-3 (concrete code shown)
- §4 Files touched → Task 3 Step 5 (patch contents verified)
- §5 Error handling → Task 3 Step 2 Change B (render-throw branch preserved via existing try/catch in renderComponent + the new branch still emits host + empty DSD + children)
- §6 Testing → Task 1, Task 4, Task 5
- §7 Risks → mitigations woven into Task 3 (atomic patch), Task 5 (full matrix), Task 6 (smoke)
- §8 Upstream PRD → Task 7

Placeholder scan: every code block is concrete; every command shows expected output; no `TBD`/`TODO`. Cross-task references use consistent names: `flattenStyles`, `DSD_SENTINEL_STYLE_ID`, `expandNestedCEs`, `renderElenaPage`. The patch sentinel id (`caribou-dsd-style`) matches `apps/caribou-elena/pages/components/elena-shadow.ts:43-50`.

Type/signature consistency: `flattenStyles(styles: unknown): string` in both TS and JS (untyped). `ComponentClass.shadow` typed as `'open' | 'closed' | undefined` via the `as unknown as { shadow?: … }` cast in TS, plain property access in JS. `expandNestedCEs(html, ceMap, depth?)` signature unchanged from current code.
