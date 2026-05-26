# Caribou shell SPA nav via composite `<litro-link>` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land SPA nav for every shell link in Caribou using a composite `<litro-link>` wrapper that intercepts clicks via composedPath while keeping the actual `<a href>` in light DOM at each call site. Also fix the pre-existing `pages/home.ts` / `pages/index.ts` tagName collision that breaks SPA nav between `/home` and `/`.

**Architecture:** Two coupled changes — (1) replace upstream Elena `LitroLink` (in `patches/@beatzball__litro@0.9.1.patch`) with a no-render / no-shadow click-intercepting wrapper; (2) wrap each shell `<a href>` + each blog text-link with `<litro-link>` and rename `pages/index.ts`'s `tagName` from `page-home` to `page-index`. SSR adapter does not need to register `<litro-link>` server-side — pass-through is correct for the composite shape.

**Tech Stack:** TypeScript, pnpm patch, Vitest (happy-dom), Playwright chromium.

**Spec:** `docs/superpowers/specs/2026-05-25-caribou-composite-litro-link-spa-nav-design.md`

---

## File Structure

**Modified (via pnpm patch):**
- `patches/@beatzball__litro@0.9.1.patch` — two new hunks: `src/adapter/elena/runtime/LitroLink.ts` and `dist/adapter/elena/runtime/LitroLink.js` (composite rewrite). The pre-existing four hunks (PR #22's `adapter/elena/index.{ts,js}` + `plugins/path-to-route.{ts,js}`) stay untouched. Patch ends with 6 `diff --git` headers.

**Modified (Caribou source):**
- `apps/caribou-elena/pages/index.ts` — change `static override tagName` from `'page-home'` to `'page-index'`.
- `apps/caribou-elena/pages/components/caribou-nav-rail.ts` — wrap 4 anchors in `<litro-link>`; add `litro-link { display: contents }` to the shadow CSS.
- `apps/caribou-elena/pages/components/caribou-right-rail.ts` — wrap Privacy/About in `<litro-link>`; add `litro-link { display: contents }` to the shadow CSS.
- `apps/caribou-elena/pages/components/caribou-auth-required.ts` — wrap Sign-in `<a>` in `<litro-link>`.
- `apps/caribou-elena/pages/local.ts` + `pages/public.ts` — wrap Retry `<a>` in `<litro-link>`.
- `apps/caribou-elena/pages/blog/index.ts` — convert each text-only `<litro-link href="…">text</litro-link>` to `<litro-link><a href="…">text</a></litro-link>`.
- `apps/caribou-elena/pages/blog/[slug].ts` — same conversion for the two text-only `<litro-link>` instances in the render template.

**Modified (test files):**
- `apps/caribou-elena/pages/components/__tests__/caribou-nav-rail.test.ts` — queries adjusted to assert inner `<a>` + `<litro-link>` wrapper.
- `apps/caribou-elena/pages/components/__tests__/caribou-right-rail.test.ts` — same pattern.
- `apps/caribou-elena/pages/components/__tests__/caribou-auth-required.test.ts` — same pattern.
- `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts` — append one assertion per route: every shell `<a href="/…">` in the response's light-DOM tree is enclosed in a `<litro-link>`.

**Created:**
- `apps/caribou-elena/pages/components/__tests__/litro-link.test.ts` — new vitest file covering the composite click-handler semantics.
- `.changeset/composite-litro-link-spa-nav.md` — patch-bump changeset.
- `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md` — hand-off PRD for upstream Litro.

**Not touched:**
- GitHub external link in `caribou-right-rail.ts:35` — stays plain `<a target="_blank">`.
- Signout `<form action="/api/signout" method="post">` in `caribou-nav-rail.ts` — stays a POST form.
- `apps/caribou-elena/pages/home.ts` — its `static tagName = 'page-home'` is correct as-is; the rename happens on `pages/index.ts` only.
- `pages/__tests__/home.test.ts`, `pages/__tests__/public.test.ts` — exercise `pageData`, not link markup.

---

## Task 1: Red gate — new + updated tests

**Files:**
- Create: `apps/caribou-elena/pages/components/__tests__/litro-link.test.ts`
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-nav-rail.test.ts`
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-right-rail.test.ts`
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-auth-required.test.ts`
- Modify: `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts`

- [ ] **Step 1: Create the new `litro-link.test.ts`**

Create `apps/caribou-elena/pages/components/__tests__/litro-link.test.ts` with this exact content:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @beatzball/litro-router so we can spy on go() without real router state.
const goSpy = vi.fn()
vi.mock('@beatzball/litro-router', () => ({
  LitroRouter: { go: goSpy },
}))

beforeAll(async () => {
  // Side-effect import — triggers LitroLink.define().
  await import('@beatzball/litro/adapter/elena/runtime')
})

beforeEach(() => {
  document.body.innerHTML = ''
  goSpy.mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function flush() {
  // Two microtasks: one for the dynamic-import promise resolution, one for
  // the .then() callback that calls LitroRouter.go.
  await Promise.resolve()
  await Promise.resolve()
}

describe('<litro-link> composite click handler', () => {
  it('intercepts a main-button click on the inner <a> and routes via LitroRouter', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const a = document.querySelector('a')!
    a.click()
    await flush()
    expect(goSpy).toHaveBeenCalledWith('/foo')
  })

  it('ignores middle-click (button !== 0)', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const a = document.querySelector('a')!
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, button: 1 }))
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks with modifier keys', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const a = document.querySelector('a')!
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      goSpy.mockClear()
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, [modifier]: true }))
      await flush()
      expect(goSpy, `should not route with ${modifier}`).not.toHaveBeenCalled()
    }
  })

  it('ignores clicks on <a target="_blank">', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo" target="_blank">x</a></litro-link>`
    await Promise.resolve()
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks on external <a href="https://…">', async () => {
    document.body.innerHTML = `<litro-link><a href="https://example.com/x">x</a></litro-link>`
    await Promise.resolve()
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks on fragment <a href="#section">', async () => {
    document.body.innerHTML = `<litro-link><a href="#section">x</a></litro-link>`
    await Promise.resolve()
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('ignores clicks on the host that do not hit any <a>', async () => {
    document.body.innerHTML = `<litro-link><span>no anchor here</span></litro-link>`
    await Promise.resolve()
    document.querySelector('span')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('respects defaultPrevented from prior listener', async () => {
    document.body.innerHTML = `<litro-link><a href="/foo">x</a></litro-link>`
    await Promise.resolve()
    const link = document.querySelector('litro-link')!
    link.addEventListener('click', (e) => e.preventDefault(), true)
    document.querySelector('a')!.click()
    await flush()
    expect(goSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Update `caribou-nav-rail.test.ts`**

Replace the file contents with:

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-nav-rail.js')
})

describe('<caribou-nav-rail>', () => {
  it('renders four nav <litro-link> wrappers each containing an <a>; active route has aria-current="page"', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    el.setAttribute('current', '/local')
    document.body.appendChild(el)
    await Promise.resolve()
    const wrappers = el.shadowRoot!.querySelectorAll('litro-link')
    expect(wrappers.length).toBe(4)
    for (const w of wrappers) {
      expect(w.querySelector('a'), '<litro-link> should wrap an <a>').toBeTruthy()
    }
    const activeAnchor = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(activeAnchor?.getAttribute('href')).toBe('/local')
  })

  it('renders a /home <a> inside a <litro-link>', async () => {
    const el = document.createElement('caribou-nav-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    const a = el.shadowRoot!.querySelector('a[href="/home"]')
    expect(a).toBeTruthy()
    expect(a?.closest('litro-link')).toBeTruthy()
  })

  it('treats /@me/* as active for the Profile anchor', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    el.setAttribute('current', '/@me/posts')
    document.body.appendChild(el)
    await Promise.resolve()
    const active = el.shadowRoot!.querySelector('a[aria-current="page"]')
    expect(active?.getAttribute('href')).toBe('/@me')
  })

  it('renders sign-out as a POST form to /api/signout (not a link)', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-nav-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('a[href="/api/signout"]')).toBeFalsy()
    expect(el.shadowRoot!.querySelector('litro-link[href="/api/signout"]')).toBeFalsy()
    const form = el.shadowRoot!.querySelector('form[action="/api/signout"]')
    expect(form).toBeTruthy()
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
    expect(form?.querySelector('button[type="submit"]')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Update `caribou-right-rail.test.ts`**

Find the "renders about card + privacy/about links" test (lines 8-16 of current file) and replace it with:

```ts
  it('renders about card + privacy/about links wrapped in <litro-link>', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-right-rail')
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.textContent).toContain('Caribou')
    const privacy = el.shadowRoot!.querySelector('a[href="/privacy"]')
    const about = el.shadowRoot!.querySelector('a[href="/about"]')
    expect(privacy).toBeTruthy()
    expect(privacy?.closest('litro-link')).toBeTruthy()
    expect(about).toBeTruthy()
    expect(about?.closest('litro-link')).toBeTruthy()
  })
```

Leave the other three tests in the file (signed-in indicator, omits indicator, disabled slots) untouched.

- [ ] **Step 4: Update `caribou-auth-required.test.ts`**

Find the "renders sign-in CTA copy and link to /" test (lines 6-17 of current file) and replace it with:

```ts
  it('renders sign-in CTA copy and link to / wrapped in <litro-link>', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-auth-required') as HTMLElement & { label: string }
    el.label = '/home shows your personal timeline.'
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.textContent).toContain('Sign in to continue')
    expect(el.textContent).toContain('/home shows your personal timeline.')
    const link = el.querySelector<HTMLAnchorElement>('a[href="/"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('Sign in')
    expect(link!.closest('litro-link')).toBeTruthy()
  })
```

Leave the "uses light DOM (no shadowRoot)" test at the end of the file untouched.

- [ ] **Step 5: Add SSR integration assertion**

Edit `apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts`. Inside the existing `describe.each(ROUTES)` block, after the `__litro_data__` test (the last `it` in the block today), append:

```ts
  it('every shell <a href="/…"> is wrapped in <litro-link>', () => {
    const lightDOM = stripDSDTemplates(body)
    const anchorMatches = [...lightDOM.matchAll(/<a\s[^>]*href="(\/[^"#][^"]*)"[^>]*>/g)]
    expect(anchorMatches.length, 'response should contain at least one internal-link <a>').toBeGreaterThan(0)
    for (const m of anchorMatches) {
      const idx = m.index ?? 0
      const before = lightDOM.slice(Math.max(0, idx - 400), idx)
      // Confirm an unclosed <litro-link> opens before this <a> within ~400 chars.
      const lastOpen = before.lastIndexOf('<litro-link')
      const lastClose = before.lastIndexOf('</litro-link>')
      expect(
        lastOpen,
        `internal <a href="${m[1]}"> at offset ${idx} must be inside a <litro-link>`,
      ).toBeGreaterThan(lastClose)
    }
  })
```

Keep all four pre-existing assertions per route (DSD presence, slotted child, no leaked `<slot>`, `__litro_data__.kind`) untouched.

- [ ] **Step 6: Build current state + run all five test files to verify red**

```bash
pnpm --filter caribou-elena build
pnpm --filter caribou-elena exec vitest run \
  pages/components/__tests__/litro-link.test.ts \
  pages/components/__tests__/caribou-nav-rail.test.ts \
  pages/components/__tests__/caribou-right-rail.test.ts \
  pages/components/__tests__/caribou-auth-required.test.ts \
  tests/integration/ssr-slot-composition.test.ts
```

Expected failure shape:

- **`litro-link.test.ts`** — the first assertion ("intercepts a main-button click…") fails because the current upstream LitroLink reads `this.href` not the inner `<a>`'s href; with no `href` attribute on `<litro-link>`, the handler bails. Most of the "ignores X" assertions pass coincidentally (the handler bails on these for other reasons too), but several fail because the current LitroLink renders its own `<a>` (replacing the author's inner content), so `document.querySelector('a')` returns LitroLink's auto-emitted anchor with `href=""`, the click handler reads `this.href === ''`, bails — and `goSpy` is never called. Net: at least the first assertion fails; the exact failure count is informational.

- **`caribou-nav-rail.test.ts`** — three tests fail because `el.shadowRoot.querySelectorAll('litro-link')` returns 0 elements (shell components on `main` use plain `<a>`, no `<litro-link>` wrapper).

- **`caribou-right-rail.test.ts`** — the "privacy/about" test fails because `closest('litro-link')` returns null.

- **`caribou-auth-required.test.ts`** — the "sign-in CTA" test fails for the same reason.

- **`ssr-slot-composition.test.ts`** — the new assertion fails on each of the 4 routes because the SSR'd shell anchors aren't wrapped in `<litro-link>` yet.

Total expected: ≥ 9 failed assertions across the matrix. Other assertions (form-POST test, light-DOM test, signed-in indicator, disabled slots, the 4 pre-existing integration assertions × 4 routes = 16) continue to pass.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/caribou-elena/pages/components/__tests__/litro-link.test.ts \
  apps/caribou-elena/pages/components/__tests__/caribou-nav-rail.test.ts \
  apps/caribou-elena/pages/components/__tests__/caribou-right-rail.test.ts \
  apps/caribou-elena/pages/components/__tests__/caribou-auth-required.test.ts \
  apps/caribou-elena/tests/integration/ssr-slot-composition.test.ts
git commit -m "test(caribou-elena): expect composite <litro-link> wrapping inner <a> (red)"
```

---

## Task 2: Patch upstream Elena `LitroLink` to composite shape

**Files:**
- Modify: `patches/@beatzball__litro@0.9.1.patch` (regenerated by `pnpm patch-commit`)

The current patch on `main` contains 4 hunks (2 path-to-route, 2 adapter/elena/index from PR #22). This task adds 2 more hunks for `adapter/elena/runtime/LitroLink.{ts,js}`. Final patch has 6 `diff --git` headers.

- [ ] **Step 1: Open a patch workspace**

```bash
pnpm patch @beatzball/litro@0.9.1
```

pnpm prints a temp directory path. Capture it:

```bash
PATCH_DIR=<the path pnpm just printed>
ls "$PATCH_DIR/src/adapter/elena/runtime/LitroLink.ts" "$PATCH_DIR/dist/adapter/elena/runtime/LitroLink.js"
```

Both files must exist before proceeding.

- [ ] **Step 2: Replace `src/adapter/elena/runtime/LitroLink.ts`**

Replace the entire file at `$PATCH_DIR/src/adapter/elena/runtime/LitroLink.ts` with:

```typescript
/**
 * LitroLink (Elena) — <litro-link>
 *
 * Composite SPA-navigation wrapper. Author writes:
 *
 *   <litro-link><a href="/path">Label</a></litro-link>
 *
 * This element has no render(), no shadow root, no styles, no props.
 * Children pass through to the parent's tree (the author-supplied <a>
 * stays in light DOM relative to whatever shadow root encloses it, so
 * link-hint tools / screen readers / focus traversal see it normally).
 *
 * On click, the host's capture-phase handler walks composedPath to find
 * the inner <a>. If the anchor is an internal same-origin path with no
 * `target` attribute and the click has no modifier keys, the default is
 * prevented and the URL is routed via LitroRouter.go(). Otherwise the
 * click passes through (Cmd-click for new tab, middle-click, external
 * links, fragments, downloads all behave like a plain <a>).
 */

import { Elena } from '@elenajs/core';

export class LitroLink extends Elena(HTMLElement) {
  static tagName = 'litro-link';
  // No shadow, no styles, no props, no render() — Elena's _applyRender
  // no-ops when render() returns undefined (see the LitroOutlet precedent).

  private _clickHandler = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.defaultPrevented) return;

    const path = e.composedPath();
    let anchor: HTMLAnchorElement | undefined;
    for (const node of path) {
      if (node === this) break;
      if (node instanceof HTMLAnchorElement) {
        anchor = node;
        break;
      }
    }
    if (!anchor) return;
    if (anchor.target) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/')) return;

    e.preventDefault();
    void import('@beatzball/litro-router').then(({ LitroRouter }) =>
      LitroRouter.go(href),
    );
  };

  override connectedCallback(): void {
    this.addEventListener('click', this._clickHandler, true);
    if (typeof super.connectedCallback === 'function') {
      super.connectedCallback();
    }
  }

  override disconnectedCallback(): void {
    this.removeEventListener('click', this._clickHandler, true);
    if (typeof super.disconnectedCallback === 'function') {
      super.disconnectedCallback();
    }
  }
}

LitroLink.define();
```

- [ ] **Step 3: Replace `dist/adapter/elena/runtime/LitroLink.js`**

Replace the entire file at `$PATCH_DIR/dist/adapter/elena/runtime/LitroLink.js` with:

```javascript
/**
 * LitroLink (Elena) — <litro-link>
 *
 * Composite SPA-navigation wrapper. Author writes:
 *   <litro-link><a href="/path">Label</a></litro-link>
 *
 * No render, no shadow, no styles. Capture-phase click handler walks
 * composedPath to find the inner <a> and routes via LitroRouter when
 * the anchor is an internal same-origin path with no target / modifier.
 */
import { Elena } from '@elenajs/core';
export class LitroLink extends Elena(HTMLElement) {
    constructor() {
        super(...arguments);
        this._clickHandler = (e) => {
            if (e.button !== 0)
                return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                return;
            if (e.defaultPrevented)
                return;
            const path = e.composedPath();
            let anchor;
            for (const node of path) {
                if (node === this)
                    break;
                if (node instanceof HTMLAnchorElement) {
                    anchor = node;
                    break;
                }
            }
            if (!anchor)
                return;
            if (anchor.target)
                return;
            const href = anchor.getAttribute('href');
            if (!href || !href.startsWith('/'))
                return;
            e.preventDefault();
            void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(href));
        };
    }
    static { this.tagName = 'litro-link'; }
    connectedCallback() {
        this.addEventListener('click', this._clickHandler, true);
        if (typeof super.connectedCallback === 'function') {
            super.connectedCallback();
        }
    }
    disconnectedCallback() {
        this.removeEventListener('click', this._clickHandler, true);
        if (typeof super.disconnectedCallback === 'function') {
            super.disconnectedCallback();
        }
    }
}
LitroLink.define();
```

(Drop the trailing `//# sourceMappingURL=LitroLink.js.map` line — the map is stale after this rewrite; pnpm-patch keeps it referenced harmlessly.)

- [ ] **Step 4: Commit the patch**

```bash
pnpm patch-commit "$PATCH_DIR"
```

pnpm regenerates `patches/@beatzball__litro@0.9.1.patch` with the new hunks and reinstalls the dep under a fresh patch-hash directory.

- [ ] **Step 5: Sanity-check the patch contents**

```bash
grep -E '^diff --git' patches/@beatzball__litro@0.9.1.patch
```

Expected exactly 6 lines (order may vary):

```
diff --git a/dist/adapter/elena/index.js b/dist/adapter/elena/index.js
diff --git a/dist/adapter/elena/runtime/LitroLink.js b/dist/adapter/elena/runtime/LitroLink.js
diff --git a/dist/plugins/path-to-route.js b/dist/plugins/path-to-route.js
diff --git a/src/adapter/elena/index.ts b/src/adapter/elena/index.ts
diff --git a/src/adapter/elena/runtime/LitroLink.ts b/src/adapter/elena/runtime/LitroLink.ts
diff --git a/src/plugins/path-to-route.ts b/src/plugins/path-to-route.ts
```

If any of the four pre-existing hunks (`path-to-route`, `adapter/elena/index`) are missing or modified, you've regressed `main` — re-open the patch workspace and restore them, then `pnpm patch-commit` again.

- [ ] **Step 6: Stage and commit**

```bash
git status --short
git add patches/@beatzball__litro@0.9.1.patch pnpm-lock.yaml
git commit -m "fix(litro-patch): composite <litro-link> for SPA nav

Replaces Elena's LitroLink with a no-render / no-shadow wrapper that
intercepts clicks via composedPath and routes via LitroRouter.go when
the inner <a> is an internal same-origin path with no target / modifier.
Children pass through, so the <a> stays in light DOM at the call site
where link-hint tools and screen readers can find it.

Supersedes the unmerged phase-4.2 shadow+slot LitroLink experiment,
which made nav-rail anchors invisible to Vimium because the <a> ended
up two shadow boundaries deep (caribou-nav-rail.shadow → litro-link.shadow
→ a). The composite shape keeps the click target one shadow boundary
deep at most — the same level as the signout button that Vimium
already finds correctly."
```

Stage only files pnpm actually changed (check `git status` first).

---

## Task 3: Caribou source — tagName rename + shell anchor wrap + blog wrap

**Files:**
- Modify: `apps/caribou-elena/pages/index.ts`
- Modify: `apps/caribou-elena/pages/components/caribou-nav-rail.ts`
- Modify: `apps/caribou-elena/pages/components/caribou-right-rail.ts`
- Modify: `apps/caribou-elena/pages/components/caribou-auth-required.ts`
- Modify: `apps/caribou-elena/pages/local.ts`
- Modify: `apps/caribou-elena/pages/public.ts`
- Modify: `apps/caribou-elena/pages/blog/index.ts`
- Modify: `apps/caribou-elena/pages/blog/[slug].ts`

- [ ] **Step 1: Rename `pages/index.ts` tagName**

Edit `apps/caribou-elena/pages/index.ts` line 6. Change:

```ts
  static override tagName = 'page-home'
```

to:

```ts
  static override tagName = 'page-index'
```

(Single-line change; rest of file unchanged.)

- [ ] **Step 2: Update `caribou-nav-rail.ts` — wrap anchors + add display:contents**

Edit `apps/caribou-elena/pages/components/caribou-nav-rail.ts`. Two changes:

**Change A** — insert one line into `NAV_RAIL_CSS` (currently lines 7-43). Right after the closing brace of the `a:hover, .signout-btn:hover` rule (line 21 of the current source), add:

```css
  litro-link { display: contents; }
```

The full nav-rail CSS block now reads (showing only the host-component selectors for clarity; responsive media queries below are untouched):

```css
  :host { display: block; }
  nav { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
  a, .signout-btn {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    color: var(--fg-1); text-decoration: none; border-radius: var(--radius-md);
    box-sizing: border-box;
  }
  .signout-btn {
    width: 100%;
    background: transparent; border: 0; cursor: pointer;
    font: inherit; text-align: left;
  }
  a:hover, .signout-btn:hover { background: var(--bg-1); }
  a[aria-current="page"] { background: var(--bg-2); color: var(--fg-0); }
  litro-link { display: contents; }
  .signout-form { display: contents; }
  .icon { width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
  .icon svg { width: 20px; height: 20px; }
```

The two responsive media queries at the bottom of `NAV_RAIL_CSS` (lines 29-42) stay verbatim — their selectors target `a, .signout-btn` which still applies because the `<a>` flows in nav-rail's shadow tree (the `<litro-link>` wrapper is `display: contents`).

**Change B** — wrap each rendered anchor in `<litro-link>`. Replace lines 68-72 (the two `html\`<a …>…</a>\`` branches inside `ITEMS.map`) with:

```ts
          return isActive
            ? html`<litro-link><a href="${it.href}" aria-current="page"><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a></litro-link>`
            : html`<litro-link><a href="${it.href}"><span class="icon">${it.icon}</span><span class="label">${it.label}</span></a></litro-link>`
```

Everything else in the file (the `<form class="signout-form">` and signout `<button>`) stays untouched.

- [ ] **Step 3: Update `caribou-right-rail.ts` — wrap Privacy/About + add display:contents**

Edit `apps/caribou-elena/pages/components/caribou-right-rail.ts`. Two changes:

**Change A** — add one line into `RIGHT_RAIL_CSS` (currently lines 8-19). After the `.card a:hover` rule (line 12) add:

```css
  litro-link { display: contents; }
```

The relevant block of `RIGHT_RAIL_CSS` now reads:

```css
  .card  { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-3); }
  .card a { color: var(--fg-1); text-decoration: none; }
  .card a:hover { color: var(--accent); }
  litro-link { display: contents; }
  .links { list-style: none; margin: 0; padding: 0; }
  .links a { display: block; padding: var(--space-2) 0; }
```

**Change B** — wrap Privacy/About anchors. Replace lines 39-40:

```ts
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/about">About</a></li>
```

with:

```ts
          <li><litro-link><a href="/privacy">Privacy</a></litro-link></li>
          <li><litro-link><a href="/about">About</a></litro-link></li>
```

The GitHub external `<a href="${REPO_URL}" rel="noopener" target="_blank">GitHub</a>` at line 35 stays unchanged.

- [ ] **Step 4: Update `caribou-auth-required.ts` — wrap Sign-in**

Edit `apps/caribou-elena/pages/components/caribou-auth-required.ts` line 15. Change:

```ts
          <a href="/" class="text-accent underline">Sign in</a>
```

to:

```ts
          <litro-link><a href="/" class="text-accent underline">Sign in</a></litro-link>
```

- [ ] **Step 5: Update `pages/local.ts` — wrap Retry**

Edit `apps/caribou-elena/pages/local.ts` line 61. Change:

```ts
            Couldn't load /local. <a href="/local" class="text-accent underline">Retry</a>
```

to:

```ts
            Couldn't load /local. <litro-link><a href="/local" class="text-accent underline">Retry</a></litro-link>
```

- [ ] **Step 6: Update `pages/public.ts` — wrap Retry**

Edit `apps/caribou-elena/pages/public.ts` line 61. Change:

```ts
            Couldn't load /public. <a href="/public" class="text-accent underline">Retry</a>
```

to:

```ts
            Couldn't load /public. <litro-link><a href="/public" class="text-accent underline">Retry</a></litro-link>
```

- [ ] **Step 7: Update `pages/blog/index.ts` — wrap text-only links with inner <a>**

Edit `apps/caribou-elena/pages/blog/index.ts`. Replace lines 12-16 (the four `<litro-link href="…">…</litro-link>` instances) with:

```ts
          <li><litro-link><a href="/blog/hello-world">Hello World</a></litro-link></li>
          <li><litro-link><a href="/blog/getting-started">Getting Started</a></litro-link></li>
          <li><litro-link><a href="/blog/about-litro">About Litro</a></litro-link></li>
        </ul>
        <litro-link><a href="/">← Back Home</a></litro-link>
```

(The closing `</ul>` and surrounding markup stay unchanged.)

- [ ] **Step 8: Update `pages/blog/[slug].ts` — wrap text-only links with inner <a>**

Edit `apps/caribou-elena/pages/blog/[slug].ts`. Replace the two `<litro-link href="…">…</litro-link>` instances in the render template with:

```ts
        <litro-link><a href="/blog">← Back to Blog</a></litro-link>
         | 
        <litro-link><a href="/">← Home</a></litro-link>
```

- [ ] **Step 9: Run unit tests to verify green**

```bash
pnpm --filter caribou-elena exec vitest run \
  pages/components/__tests__/litro-link.test.ts \
  pages/components/__tests__/caribou-nav-rail.test.ts \
  pages/components/__tests__/caribou-right-rail.test.ts \
  pages/components/__tests__/caribou-auth-required.test.ts
```

Expected: all green. `litro-link.test.ts` has 8 tests (composite click handler); the three component tests have 4 / 4 / 2 tests respectively. Integration test still needs the rebuild from Task 4 to go green.

- [ ] **Step 10: Commit**

```bash
git add \
  apps/caribou-elena/pages/index.ts \
  apps/caribou-elena/pages/components/caribou-nav-rail.ts \
  apps/caribou-elena/pages/components/caribou-right-rail.ts \
  apps/caribou-elena/pages/components/caribou-auth-required.ts \
  apps/caribou-elena/pages/local.ts \
  apps/caribou-elena/pages/public.ts \
  apps/caribou-elena/pages/blog/index.ts \
  apps/caribou-elena/pages/blog/[slug].ts
git commit -m "feat(caribou-elena): wrap shell + blog <a> in composite <litro-link>; rename / route tag

Nine shell anchors (4 nav-rail + 2 right-rail + 1 auth-required +
2 retry) and 5 blog anchors are now wrapped in <litro-link>. Clicks
SPA-navigate via LitroRouter.go; the <a> stays in light DOM so link
hints and screen readers see it.

pages/index.ts's static tagName changes from 'page-home' to
'page-index' so / and /home no longer collide in the custom
element registry. Elena's defineElement is first-define-wins; pre-
rename, whichever page module imported first claimed 'page-home',
masking the bug client-side and producing wrong SSR output for one
of the two routes. Build will regenerate routes.generated.ts +
server/stubs/page-manifest.ts with componentTag: 'page-index' for
the / route."
```

---

## Task 4: Rebuild + verify integration test green

**Files:** none modified — verification only.

- [ ] **Step 1: Rebuild**

```bash
pnpm --filter caribou-elena build
```

Expected: build succeeds. `routes.generated.ts` and `server/stubs/page-manifest.ts` regenerate; `/` route now maps to `componentTag: 'page-index'`.

- [ ] **Step 2: Confirm generated route shape**

```bash
grep -A 4 '"path": "/"' apps/caribou-elena/server/stubs/page-manifest.ts | head -8
grep -B 1 -A 4 'path: "/"' apps/caribou-elena/routes.generated.ts | head -8
```

Expected: both show `componentTag` (or `component`) `'page-index'` for `/` and `'page-home'` for `/home`. If either still shows `'page-home'` for `/`, the source change in Task 3 Step 1 didn't take — re-check `pages/index.ts:6`.

- [ ] **Step 3: Run integration test**

```bash
pnpm --filter caribou-elena exec vitest run tests/integration/ssr-slot-composition.test.ts
```

Expected: all 20 assertions green (5 per route × 4 routes). The new "every shell `<a href='/…'>` is wrapped in `<litro-link>`" assertion finds the wrapper opener immediately before each shell anchor in the response's light-DOM strip.

If any route's new assertion fails, eyeball the rendered HTML:

```bash
PORT=4151 node apps/caribou-elena/dist/server/server/index.mjs > /tmp/srv.log 2>&1 &
sleep 4
curl -s http://localhost:4151/local | grep -oE '<(litro-link|a) [^>]{0,80}' | head -20
kill %1
```

Each shell internal-link `<a>` should appear immediately after a `<litro-link>` opener with no intervening `</litro-link>` close.

---

## Task 5: Full matrix

**Files:** none modified — verification only.

- [ ] **Step 1: Run all Caribou tests**

```bash
pnpm -r test
```

Expected: every package green.

- [ ] **Step 2: Typecheck**

```bash
pnpm -r typecheck
```

Expected: clean.

- [ ] **Step 3: Full build**

```bash
pnpm -r build
```

Expected: every package builds.

- [ ] **Step 4: Playwright chromium**

Caribou's playwright config uses port 3000 with `reuseExistingServer: !isCI`. If port 3000 is occupied locally (e.g., by Obsidian — known quirk), Playwright connects to that and every test fails. Workaround: start the built server on a free port and point Playwright at it via `E2E_BASE_URL`:

```bash
PORT=4152 node apps/caribou-elena/dist/server/server/index.mjs > /tmp/srv-pw.log 2>&1 &
SERVER_PID=$!
sleep 4
E2E_BASE_URL=http://localhost:4152 pnpm --filter caribou-elena exec playwright test --project=chromium --reporter=line
kill $SERVER_PID
wait 2>/dev/null
```

If port 3000 is free, use the simpler invocation:

```bash
pnpm --filter caribou-elena exec playwright test --project=chromium
```

Expected: 14 passed, 1 skipped (`shell-poc.spec.ts:36` — pre-existing intentional skip).

---

## Task 6: Manual smoke + changeset

**Files:**
- Create: `.changeset/composite-litro-link-spa-nav.md`

- [ ] **Step 1: SSR curl smoke**

```bash
PORT=4153 node apps/caribou-elena/dist/server/server/index.mjs > /tmp/srv-smoke.log 2>&1 &
SERVER_PID=$!
sleep 4
for route in / /home /local /public /@me; do
  echo "=== $route ==="
  body=$(curl -s "http://localhost:4153${route}")
  echo "litro-link count: $(printf '%s' "$body" | grep -oc '<litro-link\b')"
  echo "internal <a> not inside litro-link: $(printf '%s' "$body" | python3 -c '
import re, sys
html = sys.stdin.read()
# Strip DSD templates
while True:
  m = re.search(r"<template shadowrootmode=\"[^\"]*\">", html)
  if not m: break
  start = m.start(); depth = 1; scan = m.end()
  while depth > 0 and scan < len(html):
    no = html.find("<template", scan); nc = html.find("</template>", scan)
    if nc == -1: break
    if no != -1 and no < nc: depth += 1; scan = no + len("<template")
    else: depth -= 1; scan = nc + len("</template>")
  html = html[:start] + html[scan:]
anchors = list(re.finditer(r"<a\s[^>]*href=\"(/[^\"#][^\"]*)\"[^>]*>", html))
bad = 0
for m in anchors:
  before = html[max(0, m.start()-400):m.start()]
  lo = before.rfind("<litro-link"); lc = before.rfind("</litro-link>")
  if lo <= lc: bad += 1
print(bad)
')"
done
kill $SERVER_PID 2>/dev/null
wait 2>/dev/null
```

Expected per route: `litro-link count ≥ 7` (4 nav-rail + 2 right-rail + 1 auth-required/retry on every route except `/` which has caribou-landing's picker instead of auth-required) and `internal <a> not inside litro-link: 0`.

For `/` specifically: confirm the response contains `<page-index>` (NOT `<page-home>`) and the inner `<caribou-landing>` text "Caribou" appears in an `<h1>`.

```bash
PORT=4154 node apps/caribou-elena/dist/server/server/index.mjs > /tmp/srv-smoke2.log 2>&1 &
SERVER_PID=$!
sleep 4
curl -s http://localhost:4154/ | grep -oE '<page-(landing|home)\b' | sort -u
curl -s http://localhost:4154/ | grep -oE '<h1[^>]*>[^<]+</h1>' | head -1
curl -s http://localhost:4154/home | grep -oE '<page-(landing|home)\b' | sort -u
kill $SERVER_PID 2>/dev/null
wait 2>/dev/null
```

Expected: `/` shows `<page-index` and `<h1 …>Caribou</h1>`; `/home` shows `<page-home`.

- [ ] **Step 2: Browser-level smoke (optional but recommended)**

```bash
pnpm --filter caribou-elena dev:portless
```

Open the printed URL. Verify in DevTools Network panel that clicking each shell link, Privacy/About, Sign-in, Retry, and blog `Back to Blog` does NOT trigger a new document fetch — only `_data` or asset fetches happen. URL bar updates; content swaps in place; no scroll jump to top. Open Vimium (or browser's native link-hint extension); confirm every nav-rail link, right-rail link, and the Sign-in get hint labels.

Specifically validate the bug we set out to fix: at `/home` (unauthenticated), click `Sign in` in the auth-required placeholder; URL becomes `/`; the page renders `<caribou-landing>` (the instance picker, NOT the auth-required placeholder). Refresh on `/`; same thing.

- [ ] **Step 3: Write the changeset**

Create `.changeset/composite-litro-link-spa-nav.md`:

```markdown
---
"caribou-elena": patch
---

Wrap every shell `<a href>` (nav-rail Home/Local/Public/Profile, right-rail Privacy/About, auth-required Sign-in, per-route Retry, blog navigation) in a composite `<litro-link>`. Clicks now SPA-navigate via `LitroRouter.go(href)` instead of triggering full document reloads. The `<a>` stays in light DOM at each call site so link-hint extensions, screen readers, and keyboard focus traversal see anchors normally.

Also renames `pages/index.ts`'s component tagName from `page-home` to `page-index`, fixing a pre-existing collision with `pages/home.ts` that caused SSR for `/` to render the auth-required shell instead of the landing picker, and broke SPA nav from `/home` to `/`.

Depends on a `pnpm patch` of `@beatzball/litro@0.9.1` that rewrites Elena's `LitroLink` to the composite shape (no render, no shadow). Upstream PRD at `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md`.

GitHub external link, signout POST form, and shadow-DOM component DSD emission from PR #22 are unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/composite-litro-link-spa-nav.md
git commit -m "chore(caribou-elena): changeset for composite <litro-link> SPA nav"
```

---

## Task 7: Upstream PRD

**Files:**
- Create: `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md`

- [ ] **Step 1: Write the PRD**

Create `docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md`:

```markdown
---
title: Upstream PRD — Elena `<litro-link>` as composite click-intercept wrapper
date: 2026-05-25
status: ready to hand to upstream
target-repo: ~/w/beatzball/litro
target-file: packages/framework/src/adapter/elena/runtime/LitroLink.ts
companion-patch: ~/w/beatzball/caribou/patches/@beatzball__litro@0.9.1.patch (hunks for adapter/elena/runtime/LitroLink.{ts,js})
verified-by: ~/w/beatzball/caribou/apps/caribou-elena/pages/components/__tests__/litro-link.test.ts and tests/integration/ssr-slot-composition.test.ts
supersedes: docs/superpowers/specs/2026-05-12-litro-link-shadow-slot-upstream-prd.md (phase-4.2; rejected)
---

# Elena `<litro-link>` as composite click-intercept wrapper (upstream PRD)

## Problem

Elena's current `<litro-link>` renders `<a href>${this.text}</a>` in light DOM. Rich children (icon + label spans, etc.) are dropped on hydration because `this.text` is only the captured pre-upgrade text content. SSR-side `this.text` is undefined so the SSR output is an empty `<a>`.

An earlier attempt (downstream, in Caribou's `phase-4.2` branch — not merged) made Elena's `<litro-link>` shadow+slot to match the Lit and FAST adapters: `<template shadowrootmode><a><slot></slot></a></template>`. That solved rich-children but introduced a separate accessibility / tooling regression: when consumers wrap `<litro-link>` inside another shadow-DOM component (e.g., a navigation shell), the inner `<a>` is two shadow boundaries deep. Link-hint extensions (Vimium, Tridactyl, browser-native link enumeration) only walk one shadow boundary and don't find the `<a>`. The same shape exists in Lit and FAST today; consumers nesting `<litro-link>` inside a custom-element shell hit the same wall.

## Proposed change

Replace `packages/framework/src/adapter/elena/runtime/LitroLink.ts` with a composite wrapper — no render, no shadow, no styles. The author writes the semantic `<a>` directly inside the wrapper:

```html
<litro-link><a href="/path">Label</a></litro-link>
```

`<litro-link>` listens for click events via a capture-phase handler on its host. The handler walks `composedPath` to find the nearest `<a>` ancestor of the click target (bounded by the host itself). If the anchor is an internal same-origin path with no `target` attribute and the click has no modifier keys, the default is prevented and the URL is routed via `LitroRouter.go(href)`. Otherwise the click passes through (Cmd-click for new tab, middle-click, external links, fragments all behave like a plain `<a>`).

Full source: see the Caribou patch hunks at `patches/@beatzball__litro@0.9.1.patch` (entries for `src/adapter/elena/runtime/LitroLink.ts` and `dist/adapter/elena/runtime/LitroLink.js`).

## Why composite, not shadow+slot

| Shape | Rich children? | Link tools see the `<a>`? | Author markup |
|---|---|---|---|
| Light-DOM + `${this.text}` (today) | No — dropped on hydration | Yes (no shadow involved) | `<litro-link href="…">text</litro-link>` |
| Shadow+slot (Lit/FAST/phase-4.2) | Yes | No when nested in another shadow-DOM component | `<litro-link href="…">…children…</litro-link>` |
| Composite (this PRD) | Yes | Yes — `<a>` stays in author's tree | `<litro-link><a href="…">…children…</a></litro-link>` |

Composite is the only shape that satisfies both columns. The trade-off is markup verbosity (one extra wrapper element) for unambiguous behavior across nesting depth.

## Migration notes for downstream consumers

- **Text-only consumers** (currently `<litro-link href="/blog">Back</litro-link>`) must wrap the text in an explicit `<a>`: `<litro-link><a href="/blog">Back</a></litro-link>`. One-line change per call site.
- **Rich-children consumers** that worked around the upstream bug with `text` props can drop those workarounds and put the structure inside `<a>`.
- **Snapshot tests** asserting on the old `<litro-link href><a></a></litro-link>` shape (auto-rendered inner anchor) need updating to expect the author-supplied `<a>` instead.
- **Server-side registration:** the composite shape doesn't need server-side registration in `__litro_elena_ce_map__`. The SSR adapter's unregistered-tag pass-through is the correct behavior — `<litro-link>` flows through unchanged with its children intact.

## Tests Litro should add

A minimal unit test inside `packages/framework/test/` (or wherever the Elena adapter tests live) covering:

1. **Click on inner `<a>` routes via LitroRouter**: dispatching a `click` event on the inner `<a>` calls `LitroRouter.go(href)` once with the anchor's `href`.
2. **Modifier-click pass-through**: clicks with `metaKey` / `ctrlKey` / `shiftKey` / `altKey` set DO NOT call `LitroRouter.go`.
3. **Middle-click pass-through**: `button !== 0` clicks DO NOT call `LitroRouter.go`.
4. **`target="_blank"` pass-through**: clicks on an anchor with any non-empty `target` attribute DO NOT call `LitroRouter.go`.
5. **External-href pass-through**: clicks on `<a href="https://…">`, `<a href="mailto:…">`, `<a href="#fragment">`, and protocol-relative `<a href="//host/path">` DO NOT call `LitroRouter.go`.
6. **No-anchor pass-through**: clicks on the host outside any `<a>` (e.g., a `<span>` direct child) DO NOT call `LitroRouter.go`.
7. **`defaultPrevented` pass-through**: a prior listener calling `event.preventDefault()` causes the LitroLink handler to bail without routing.
8. **No render**: a fresh `<litro-link>` instance keeps its author-supplied children — `instance.innerHTML` is not replaced on connect.

## Out of scope

- Polyfill for browsers that lack `composedPath` (well-supported in all browsers Litro targets).
- Auto-prefetch on hover. Composable later; keeps the wrapper simple for now.
- Adding `<litro-link>` to Lit and FAST adapters as well. Their existing shadow+slot shape works for downstream consumers who don't nest links inside other shadow-DOM components; whether to migrate is a Litro maintainer call.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-litro-link-composite-upstream-prd.md
git commit -m "docs: upstream PRD for composite Elena <litro-link>

Hand-off document for the same fix to land in @beatzball/litro upstream
after Caribou validates the patch in production. Captures the bug
shape, why composite over shadow+slot, the migration path for existing
consumers, and the unit-test surface Litro should add. References the
phase-4.2 shadow+slot attempt as a rejected alternative."
```

---

## Self-Review

**Spec coverage check** (against `docs/superpowers/specs/2026-05-25-caribou-composite-litro-link-spa-nav-design.md`):

- §0 Goal → Tasks 1-6 collectively
- §1 Why a fresh approach → context only, no task
- §2 Scope → Tasks 2 (patch), 3 (swap + tagName + blog), 6 (changeset), 7 (PRD)
- §3 Composite shape → Task 2 Steps 2-3 (concrete code)
- §3.2 Click-handler semantics → Task 1 Step 1 (8 unit tests), Task 2 Step 2 (code)
- §3.3 Server-side pass-through → §4 (no manifestPreamble change), implicit in patch shape
- §4.1 Markup per file → Task 3 Steps 2-8 (verbatim shapes)
- §4.2 CSS `display: contents` rule → Task 3 Steps 2A, 3A
- §5 tagName fix → Task 3 Step 1
- §6 Patch surface (6 hunks) → Task 2 Step 5 (sanity check)
- §7.1 Composite click-handler unit tests → Task 1 Step 1
- §7.2 Component test updates → Task 1 Steps 2-4
- §7.3 SSR integration assertion → Task 1 Step 5
- §7.4 Full matrix → Task 5
- §7.5 Manual verification → Task 6 Steps 1-2
- §8 Risks → addressed implicitly in verification gates (Task 4-6)
- §9 Upstream PRD → Task 7
- §10 Supersedes phase-4.2 → noted in commits and PRD frontmatter

No spec sections missing from the plan.

**Placeholder scan:** every code block is concrete; every command shows expected output. The single `<the path pnpm just printed>` placeholder in Task 2 Step 1 is appropriately a runtime value the engineer captures.

**Type / signature consistency:**

- `<litro-link>` tag name consistent across HTML, CSS selectors, test queries, regex matchers.
- `composedPath` used the same way in the patch source and the unit test (event must be `composed: true` for synthetic dispatch).
- `LitroRouter.go(href)` signature consistent between LitroLink source and test mock.
- `page-index` tag name used consistently in Task 3 Step 1, smoke checks (Task 6 Step 1).
- Patch hunk count (6 `diff --git` headers) consistent between Task 2 Step 5 and spec §6.
- `display: contents` rule placement consistent between spec §4.2 and Task 3 Steps 2A/3A.
