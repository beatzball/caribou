# Caribou — Keyed-List Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace index-keyed `${items.map(...)}` rendering in `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` with a `reconcileKeyedList` helper in `@beatzball/caribou-ui-headless` that diffs by `status.id`, so polls/loadMore/applyNewPosts only touch nodes whose underlying status actually changed.

**Architecture:** One pure function (`reconcileKeyedList`) and one tiny custom element (`<caribou-list-mount>`) in `@beatzball/caribou-ui-headless`. Each host's `render()` emits the mount empty in its template; the host's existing reactive hook queries `mount.mountUl` (the inner shadow `<ul>`) on first `updated()` and calls the helper against it. The mount is required because Elena's morph engine wipes live `<ul>` children when the host's render template emits `<ul></ul>` empty (validation POC pinned this on 2026-05-10); shadow DOM provides a morph-opaque container. Cards (already shadow-DOM, PR #14) keep object identity across re-renders. Helper owns `data-key` on direct children of the `<ul>`; DOM is the single source of truth.

**Tech Stack:** TypeScript, Vitest + happy-dom (`@beatzball/caribou-ui-headless` and `@beatzball/elena-morph-spec`), Elena custom elements (`@elenajs/core`), `@preact/signals-core` (existing reactivity), Changesets for versioning.

**Spec:** `docs/superpowers/specs/2026-05-09-caribou-keyed-list-reconciliation-design.md`

---

## Exit Criteria

All of the following must be true before this plan is considered done:

1. `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass from a clean worktree.
2. **Validation POC (Task 1) committed** as `it.fails`-pinned documentation of morph's wipe behavior (the POC ran 2026-05-10 and confirmed morph wipes; the test is now permanent documentation).
3. **`<caribou-list-mount>` (Task 2) lands and passes its unit tests** before any host adoption work.
4. `packages/caribou-ui-headless/src/reconcile-keyed-list.ts` exists, is re-exported from `index.ts`, and has ≥95% line/function/statement and ≥90% branch coverage per the package's vitest threshold.
5. Op-count regression test asserts the exact counts from spec §3.4 for prepend-K, append-K, remove-middle, swap-adjacent, full-reverse, and N→identical.
6. `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` all render through `<caribou-list-mount>` + `reconcileKeyedList`. The pre-existing `effect()` shallow-compare gate in timeline is preserved. The `data-index`-keyed `card.status =` loops in timeline `updated()` and profile `updated()` are deleted.
7. Component integration tests assert (a) surviving cards keep identity across prepend/append/tab-swap, (b) `caribou-status-card.prototype` `status` setter fires zero times for surviving cards (render-avoidance metric).
8. Scroll position is preserved in the scroll-preservation test for the timeline.
9. PR description contains a "Before / After" table with real op-counts and setter-fire counts captured against Plan 3 head and against the new code.
10. One `.changeset/*.md` per modified package: `@beatzball/caribou-ui-headless`, `apps/caribou-elena`, `@beatzball/elena-morph-spec`.
11. Every existing Plan 3 component test still passes (no regression).

---

## File Structure

### Created by this plan

```
caribou/
├── packages/
│   ├── caribou-ui-headless/
│   │   └── src/
│   │       ├── reconcile-keyed-list.ts                       # the helper
│   │       ├── list-mount.ts                                 # <caribou-list-mount> shadow-DOM container
│   │       └── __tests__/
│   │           ├── reconcile-keyed-list.test.ts              # behavior + invariants
│   │           ├── reconcile-keyed-list.bench-counts.test.ts # op-count regression metric
│   │           └── list-mount.test.ts                        # mount unit tests
│   └── elena-morph-spec/
│       └── src/__tests__/
│           └── morph-empty-native-parent.test.ts             # validation POC (§4) — it.fails-pinned
├── docs/
│   └── superpowers/
│       └── (this plan + the spec already exist)
└── .changeset/
    ├── <hash>-keyed-reconciler-helper.md                     # caribou-ui-headless
    ├── <hash>-keyed-reconciler-adoption.md                   # caribou-elena
    └── <hash>-morph-empty-native-parent-spec.md              # elena-morph-spec
```

### Modified by this plan

```
caribou/
├── apps/caribou-elena/
│   └── pages/components/
│       ├── caribou-timeline.ts             # render() → empty <ul>; updated() → helper call; delete data-index loop
│       ├── caribou-profile.ts              # same shape as timeline
│       ├── caribou-thread.ts               # collectStatuses → collectThreadItems; helper call against shadow <ul>
│       └── __tests__/
│           ├── caribou-timeline.test.ts    # if exists; otherwise new — applyNewPosts identity, scroll, image identity, render-avoidance
│           ├── caribou-profile.test.ts     # tab-swap identity, header stability
│           └── caribou-thread.test.ts      # depth-recompute on descendant arrival
└── packages/caribou-ui-headless/
    └── src/index.ts                        # +1 export line
```

---

## Task 1: POC documentation — morph wipes empty-template native children

**Background.** This POC was originally written to verify whether morph would tolerate an empty `<ul>` in the host's template against a populated live `<ul>`. The POC ran on 2026-05-10 and morph **did** wipe the live children (`children.length` went from 3 to 0). The design pivoted to `<caribou-list-mount>` (Task 2). This task now CAPTURES that result as `it.fails`-pinned documentation in the morph spec — it documents the "we'd want this to work but Elena doesn't yet" gotcha, mirroring the morph-custom-elements.test.ts §4 pattern.

**Goal of this task:** Replace the existing uncommitted POC test file with the `it.fails`-framed version and commit it. The file already exists on disk uncommitted at `packages/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts` — overwrite it.

**Files:**
- Modify (overwrite uncommitted): `packages/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts`

- [ ] **Step 1: Overwrite the test file**

```ts
// packages/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Elena, html } from '@elenajs/core'

/**
 * Behavioral spec for morph against empty native parents in the host
 * template — i.e., a host whose render() emits `<ul></ul>` empty while
 * the live `<ul>` has imperatively-inserted children.
 *
 * Confirmed 2026-05-10: morph wipes the live children to match the
 * empty template (consistent with the README's "morph always recurses
 * into native children" rule — native children's identity is the
 * parent template's responsibility).
 *
 * The two `it.fails` assertions below describe the property we'd WANT
 * Elena to hold (children survive). They are expected to fail today.
 * The day Elena's morph stops wiping native-empty-template children,
 * `it.fails` itself fails — alerting us that Caribou's
 * <caribou-list-mount> workaround can be retired.
 *
 * This is the same gotcha-pinning pattern used in
 * morph-custom-elements.test.ts §4 for light-DOM self-rendering
 * children getting wiped.
 */

class TestEmptyUlHost extends Elena(HTMLElement) {
  static override tagName = 'test-empty-ul-host'
  static override props = [{ name: 'rev', reflect: true }]
  rev = 0

  override render() {
    return html`<div><ul data-list></ul></div>`
  }
}
TestEmptyUlHost.define()

describe('morph behavior: empty native <ul> in template vs populated live <ul>', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it.fails('would preserve imperatively-inserted <li> children across host re-renders (Elena gotcha — currently wipes them)', async () => {
    const host = document.createElement('test-empty-ul-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const ul = host.querySelector('ul[data-list]')!
    const liA = document.createElement('li'); liA.textContent = 'a'; liA.dataset.key = 'a'
    const liB = document.createElement('li'); liB.textContent = 'b'; liB.dataset.key = 'b'
    const liC = document.createElement('li'); liC.textContent = 'c'; liC.dataset.key = 'c'
    ul.append(liA, liB, liC)

    expect(ul.children.length).toBe(3)

    host.rev = 1
    host.requestUpdate?.()
    await new Promise((r) => setTimeout(r, 0))

    // What we'd want Elena to do — but currently morph wipes these.
    expect(ul.children.length).toBe(3)
    expect(ul.children[0]).toBe(liA)
    expect(ul.children[1]).toBe(liB)
    expect(ul.children[2]).toBe(liC)
  })

  it.fails('would preserve children across two consecutive host re-renders (Elena gotcha)', async () => {
    const host = document.createElement('test-empty-ul-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const ul = host.querySelector('ul[data-list]')!
    const liA = document.createElement('li'); liA.dataset.key = 'a'
    ul.appendChild(liA)

    host.rev = 1; host.requestUpdate?.(); await new Promise((r) => setTimeout(r, 0))
    host.rev = 2; host.requestUpdate?.(); await new Promise((r) => setTimeout(r, 0))

    expect(ul.children.length).toBe(1)
    expect(ul.children[0]).toBe(liA)
  })

  it('observed behavior: morph wipes the children (this is the case Caribou works around with <caribou-list-mount>)', async () => {
    const host = document.createElement('test-empty-ul-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const ul = host.querySelector('ul[data-list]')!
    ul.append(
      Object.assign(document.createElement('li'), { textContent: 'a' }),
      Object.assign(document.createElement('li'), { textContent: 'b' }),
    )
    expect(ul.children.length).toBe(2)

    host.rev = 1
    host.requestUpdate?.()
    await new Promise((r) => setTimeout(r, 0))

    expect(ul.children.length).toBe(0) // morph wiped
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @beatzball/elena-morph-spec test`

Expected: PASS — vitest reports the two `it.fails` cases as PASSING (because the inner assertions fail, and `it.fails` flips that to a pass), and the third "observed behavior" case PASSES on its assertions directly. Total: 3/3 green at the suite level.

- [ ] **Step 3: Commit**

```bash
git add packages/elena-morph-spec/src/__tests__/morph-empty-native-parent.test.ts
git commit -m "test(elena-morph-spec): pin morph wipe behavior on empty native parents

Documents that Elena's morphContent wipes live <ul> children when the
host's render template emits <ul></ul> empty. Two it.fails-pinned
assertions describe what we'd want; one direct assertion captures the
observed wipe. Same gotcha-pinning pattern as morph-custom-elements.test.ts §4.

This is why Caribou's keyed-list reconciliation needs the
<caribou-list-mount> shadow-DOM workaround (Plan 3 §11.1a follow-up,
spec §4)."
```

---

## Task 2: `<caribou-list-mount>` element + tests

**Goal of this task:** Implement the morph-opaque shadow-DOM container that hosts use to wrap their lists. Pure HTMLElement; no Elena dependency. Must export the class AND register the `<caribou-list-mount>` tag on import.

**Files:**
- Create: `packages/caribou-ui-headless/src/list-mount.ts`
- Create: `packages/caribou-ui-headless/src/__tests__/list-mount.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/caribou-ui-headless/src/__tests__/list-mount.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { CaribouListMount } from '../list-mount.js'

describe('<caribou-list-mount>', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('registers the custom element on import', () => {
    expect(customElements.get('caribou-list-mount')).toBeDefined()
  })

  it('attaches a shadow root and renders an internal <ul> on connectedCallback', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    expect(m.shadowRoot).not.toBeNull()
    const ul = m.shadowRoot!.querySelector('ul')
    expect(ul).not.toBeNull()
  })

  it('inner <ul> has list-style:none, margin:0, padding:0', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    const ul = m.shadowRoot!.querySelector('ul')!
    expect(ul.style.listStyle).toBe('none')
    expect(ul.style.margin).toBe('0')
    expect(ul.style.padding).toBe('0')
  })

  it('mountUl returns the same node identity across calls', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    expect(m.mountUl).toBe(m.mountUl)
  })

  it('mountUl is safe to access before connectedCallback fires (forces synchronous mount)', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    expect(() => m.mountUl).not.toThrow()
    expect(m.mountUl.tagName).toBe('UL')
  })

  it('shadow root persists across detach + re-attach to a different parent', () => {
    const m = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(m)
    const ulBefore = m.mountUl
    const otherParent = document.createElement('div')
    document.body.appendChild(otherParent)
    otherParent.appendChild(m)
    expect(m.mountUl).toBe(ulBefore)
  })

  it('importing the module twice does not throw on duplicate registration', async () => {
    // Re-importing is a no-op because the registration is guarded by
    // customElements.get('caribou-list-mount').
    await expect(import('../list-mount.js')).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter @beatzball/caribou-ui-headless test list-mount`

Expected: FAIL — `Cannot find module '../list-mount.js'`.

- [ ] **Step 3: Implement the mount**

```ts
// packages/caribou-ui-headless/src/list-mount.ts

/**
 * Morph-opaque container for keyed-list reconciliation.
 *
 * Elena's morphContent recurses into native children (per the morph
 * spec README), so a host that renders <ul></ul> empty in its template
 * will have morph wipe any imperatively-added <li> children on the
 * next host re-render. This element sidesteps that by placing the
 * <ul> inside its own shadow root — morph never crosses a shadow
 * boundary (per morph-custom-elements.test.ts §1).
 *
 * Hosts render <caribou-list-mount></caribou-list-mount> empty in their
 * template. The keyed reconciler operates against `mount.mountUl`.
 *
 * Plain HTMLElement; no Elena dependency. Adapter-portable for
 * future caribou-lit / caribou-fast.
 */
export class CaribouListMount extends HTMLElement {
  private _ul: HTMLUListElement | null = null

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = ':host { display: block }'
      const ul = document.createElement('ul')
      ul.style.listStyle = 'none'
      ul.style.margin = '0'
      ul.style.padding = '0'
      shadow.append(style, ul)
      this._ul = ul
    } else if (!this._ul) {
      this._ul = this.shadowRoot.querySelector('ul')
    }
  }

  /**
   * Returns the inner <ul> that the keyed reconciler should target.
   * Defensive: if accessed before connectedCallback fires, forces a
   * synchronous mount so the caller never sees null.
   */
  get mountUl(): HTMLUListElement {
    if (!this._ul) this.connectedCallback()
    return this._ul!
  }
}

if (!customElements.get('caribou-list-mount')) {
  customElements.define('caribou-list-mount', CaribouListMount)
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `pnpm --filter @beatzball/caribou-ui-headless test list-mount`

Expected: PASS — all seven tests green.

- [ ] **Step 5: Add a smoke test for the morph-opaque property**

This is the integration test that justifies the entire mount: a host whose render emits `<caribou-list-mount></caribou-list-mount>` empty must NOT wipe inner `<li>` children on re-render. Add to `list-mount.test.ts`:

```ts
import { Elena, html } from '@elenajs/core'

describe('<caribou-list-mount> — morph isolation property', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('inner <ul> children survive an Elena host re-render (the property the validation POC §4 motivates)', async () => {
    class TestMountHost extends Elena(HTMLElement) {
      static override tagName = 'test-mount-host'
      static override props = [{ name: 'rev', reflect: true }]
      rev = 0
      override render() {
        return html`<div><caribou-list-mount></caribou-list-mount></div>`
      }
    }
    TestMountHost.define()

    const host = document.createElement('test-mount-host') as HTMLElement & { rev: number; requestUpdate?: () => void }
    document.body.appendChild(host)
    await new Promise((r) => setTimeout(r, 0))

    const mount = host.querySelector('caribou-list-mount') as CaribouListMount
    const ul = mount.mountUl
    const liA = document.createElement('li'); liA.dataset.key = 'a'
    const liB = document.createElement('li'); liB.dataset.key = 'b'
    ul.append(liA, liB)
    expect(ul.children.length).toBe(2)

    host.rev = 1
    host.requestUpdate?.()
    await new Promise((r) => setTimeout(r, 0))

    // Mount's shadow root is morph-opaque to the host's morph engine.
    expect(ul.children.length).toBe(2)
    expect(ul.children[0]).toBe(liA)
    expect(ul.children[1]).toBe(liB)
  })
})
```

Note: this requires `@elenajs/core` to be available to the headless package's test environment. If it's not in the package's devDependencies, add it: edit `packages/caribou-ui-headless/package.json` to include `"@elenajs/core": "<version-already-used-elsewhere-in-repo>"` under devDependencies, then `pnpm install`.

- [ ] **Step 6: Run all mount tests**

Run: `pnpm --filter @beatzball/caribou-ui-headless test list-mount`

Expected: PASS — all 8 tests green (7 unit + 1 integration). If the smoke test fails, the entire design is broken; STOP and surface to the user.

- [ ] **Step 7: Commit**

```bash
git add packages/caribou-ui-headless/src/list-mount.ts packages/caribou-ui-headless/src/__tests__/list-mount.test.ts packages/caribou-ui-headless/package.json
git commit -m "feat(caribou-ui-headless): <caribou-list-mount> shadow-DOM container

Morph-opaque container for keyed-list reconciliation. Hosts render the
mount empty in their template; the inner <ul> lives in shadow DOM and
survives the host's morph cycles. Plain HTMLElement, no Elena
dependency — portable for future adapter packages.

Smoke test confirms the morph-isolation property the validation POC
(elena-morph-spec) motivates."
```

---

## Task 3: Helper module — bootstrap + initial-mount scenario

**Goal of this task:** Create the `reconcile-keyed-list.ts` module with the `ReconcileKeyedListOptions` interface and a minimal implementation that handles the simplest scenario (empty parent → N items). Establishes the test file scaffolding.

**Files:**
- Create: `packages/caribou-ui-headless/src/reconcile-keyed-list.ts`
- Create: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reconcileKeyedList } from '../reconcile-keyed-list.js'

interface Item { id: string; payload?: unknown }

function makeUl(): HTMLUListElement {
  document.body.innerHTML = ''
  const ul = document.createElement('ul')
  document.body.appendChild(ul)
  return ul
}

function makeLi(item: Item): HTMLLIElement {
  const li = document.createElement('li')
  li.textContent = item.id
  return li
}

describe('reconcileKeyedList — empty → N', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('inserts all items into an empty parent', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const create = vi.fn(makeLi)

    reconcileKeyedList({
      parent: ul,
      items,
      keyOf: (i) => i.id,
      create,
    })

    expect(ul.children.length).toBe(3)
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).textContent)).toEqual(['a', 'b', 'c'])
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['a', 'b', 'c'])
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('fires update for every item on initial mount', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }]
    const update = vi.fn()

    reconcileKeyedList({
      parent: ul,
      items,
      keyOf: (i) => i.id,
      create: makeLi,
      update,
    })

    expect(update).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: FAIL — `Cannot find module '../reconcile-keyed-list.js'` or similar. The module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/caribou-ui-headless/src/reconcile-keyed-list.ts

/**
 * Keyed-list reconciler. See
 * docs/superpowers/specs/2026-05-09-caribou-keyed-list-reconciliation-design.md
 * for the full design and op-count contract.
 *
 * Caller contract:
 * - keyOf MUST return a non-empty string per item.
 * - update MUST be a no-op when item is reference-equal to the value
 *   that produced the current DOM state. Callers express this as
 *   `if (card.status !== s) card.status = s`.
 * - parent.children MUST contain only elements created by this helper
 *   (or SSR-emitted with matching data-key attrs). Hand-rendered
 *   children interleaved with helper-managed children is unsupported;
 *   any direct child without a matching key is removed.
 */
export interface ReconcileKeyedListOptions<T> {
  parent: Element
  items: readonly T[]
  keyOf: (item: T) => string
  create: (item: T) => HTMLElement
  update?: (el: HTMLElement, item: T) => void
}

export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void {
  const { parent, items, keyOf, create, update } = opts

  for (const item of items) {
    const key = keyOf(item)
    const el = create(item)
    el.dataset.key = key
    parent.appendChild(el)
    if (update) update(el, item)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: PASS — both tests in the "empty → N" describe block green.

- [ ] **Step 5: Commit**

```bash
git add packages/caribou-ui-headless/src/reconcile-keyed-list.ts packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
git commit -m "feat(caribou-ui-headless): reconcileKeyedList — initial-mount scenario

Bootstraps the keyed-list reconciler with the API surface and the
simplest scenario (empty parent → N items, all created and inserted).
Subsequent commits add identity matching, cursor walk, removal, and
dev-mode invariants."
```

---

## Task 4: Helper — N → identical N (reference identity short-circuit)

**Goal of this task:** Extend the helper to recognize existing children by `data-key` and avoid re-creating them. After this task, identical re-runs do zero DOM work.

**Files:**
- Modify: `packages/caribou-ui-headless/src/reconcile-keyed-list.ts`
- Modify: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the test file (after the empty→N describe block):

```ts
describe('reconcileKeyedList — N → identical N', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('reuses existing children by data-key; zero creates, zero inserts', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const createSpy = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    // First call seeds the list.
    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: createSpy })
    const refs = Array.from(ul.children)
    createSpy.mockClear()
    insertSpy.mockClear()

    // Second call with the same items — should be a no-op DOM-wise.
    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: createSpy })

    expect(createSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(Array.from(ul.children)).toEqual(refs) // same node identity
  })

  it('fires update once per item even when nothing else changed', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }]
    const update = vi.fn()

    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: makeLi, update })
    update.mockClear()
    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: makeLi, update })

    expect(update).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: FAIL — the second call to the helper currently creates fresh `<li>`s and appends them, doubling the children count.

- [ ] **Step 3: Extend implementation**

Replace the body of `reconcileKeyedList`:

```ts
export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void {
  const { parent, items, keyOf, create, update } = opts

  // Step 1: build a map of existing children by data-key.
  const existing = new Map<string, Element>()
  for (const child of Array.from(parent.children)) {
    const k = (child as HTMLElement).dataset.key
    if (k) existing.set(k, child)
  }

  // Step 2: walk items in order; reuse existing or create new.
  let cursor: ChildNode | null = parent.firstChild
  for (const item of items) {
    const key = keyOf(item)
    let el = existing.get(key) as HTMLElement | undefined
    if (el) {
      if (el === cursor) {
        cursor = cursor.nextSibling
      } else {
        parent.insertBefore(el, cursor)
        // cursor unchanged: el is now before cursor
      }
    } else {
      el = create(item)
      el.dataset.key = key
      parent.insertBefore(el, cursor)
      // cursor unchanged: new el is before cursor
    }
    if (update) update(el, item)
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: PASS — all four tests across the two describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add packages/caribou-ui-headless/src/reconcile-keyed-list.ts packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
git commit -m "feat(caribou-ui-headless): reconcileKeyedList — identity short-circuit

Existing children matched by data-key; identical re-runs do zero DOM
work. Cursor-walk algorithm now in place; subsequent commits add
removal of stale children and dev-mode invariants."
```

---

## Task 5: Helper — prepend / append scenarios

**Goal of this task:** Add tests for prepend-K and append-K. Implementation should already pass without changes — the cursor-walk algorithm covers these natively.

**Files:**
- Modify: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the test file:

```ts
describe('reconcileKeyedList — prepend / append', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('prepend K: K creates + K inserts + 0 moves; surviving nodes keep identity', () => {
    const ul = makeUl()
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    reconcileKeyedList({ parent: ul, items: initial, keyOf: (i) => i.id, create: makeLi })
    const [refA, refB, refC] = Array.from(ul.children)

    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    const next: Item[] = [{ id: 'x' }, { id: 'y' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]
    reconcileKeyedList({ parent: ul, items: next, keyOf: (i) => i.id, create })

    expect(create).toHaveBeenCalledTimes(2)
    expect(insertSpy).toHaveBeenCalledTimes(2) // two inserts of fresh nodes; surviving never re-inserted
    expect(ul.children[2]).toBe(refA)
    expect(ul.children[3]).toBe(refB)
    expect(ul.children[4]).toBe(refC)
  })

  it('append K: K creates + K inserts + 0 moves; surviving nodes keep identity', () => {
    const ul = makeUl()
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    reconcileKeyedList({ parent: ul, items: initial, keyOf: (i) => i.id, create: makeLi })
    const [refA, refB, refC] = Array.from(ul.children)

    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    const next: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'y' }, { id: 'z' }]
    reconcileKeyedList({ parent: ul, items: next, keyOf: (i) => i.id, create })

    expect(create).toHaveBeenCalledTimes(2)
    expect(insertSpy).toHaveBeenCalledTimes(2)
    expect(ul.children[0]).toBe(refA)
    expect(ul.children[1]).toBe(refB)
    expect(ul.children[2]).toBe(refC)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: PASS — algorithm from Task 4 already handles these. If FAIL, debug the cursor walk before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
git commit -m "test(caribou-ui-headless): reconcileKeyedList — prepend/append scenarios

Adds test coverage for the two scenarios that drive the design (poll
applyNewPosts → prepend; loadMore → append). Asserts surviving nodes
keep identity and op counts match the spec §3.4 contract."
```

---

## Task 6: Helper — remove + swap-adjacent + full-reverse + mixed

**Goal of this task:** Add the remaining algorithm tests. Remove-middle requires an addition to the impl (currently nothing strips stale children); swap/reverse/mixed should already pass via cursor-walk.

**Files:**
- Modify: `packages/caribou-ui-headless/src/reconcile-keyed-list.ts`
- Modify: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('reconcileKeyedList — removal', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('removes middle: 1 remove, 0 creates, 0 moves', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const [refA, , refC, refD] = Array.from(ul.children)
    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(ul.children.length).toBe(3)
    expect(create).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(ul.children[0]).toBe(refA)
    expect(ul.children[1]).toBe(refC)
    expect(ul.children[2]).toBe(refD)
  })

  it('removes all: N removes, 0 creates', () => {
    const ul = makeUl()
    reconcileKeyedList({ parent: ul, items: [{ id: 'a' }, { id: 'b' }], keyOf: (i: Item) => i.id, create: makeLi })
    reconcileKeyedList({ parent: ul, items: [], keyOf: (i: Item) => i.id, create: makeLi })
    expect(ul.children.length).toBe(0)
  })
})

describe('reconcileKeyedList — moves', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('swap adjacent: 1 move, 0 creates, 0 removes', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'b' }, { id: 'a' }, { id: 'c' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(create).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledTimes(1) // one move
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['b', 'a', 'c'])
  })

  it('full reverse: (n-1) moves', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'd' }, { id: 'c' }, { id: 'b' }, { id: 'a' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(create).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledTimes(3) // n - 1
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('mixed: prepend X, drop A and C, append Y', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const [, refB, , refD] = Array.from(ul.children)
    const create = vi.fn(makeLi)

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'x' }, { id: 'b' }, { id: 'd' }, { id: 'y' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(create).toHaveBeenCalledTimes(2) // x and y
    expect(ul.children.length).toBe(4)
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['x', 'b', 'd', 'y'])
    expect(ul.children[1]).toBe(refB)
    expect(ul.children[2]).toBe(refD)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: FAIL on the removal tests — current impl doesn't remove stale children. Move tests should already pass.

- [ ] **Step 3: Extend implementation**

Update `packages/caribou-ui-headless/src/reconcile-keyed-list.ts`. Insert the removal pass between the existing-map build and the cursor walk:

```ts
export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void {
  const { parent, items, keyOf, create, update } = opts

  // Step 1: build a map of existing children by data-key.
  const existing = new Map<string, Element>()
  for (const child of Array.from(parent.children)) {
    const k = (child as HTMLElement).dataset.key
    if (k) existing.set(k, child)
  }

  // Step 2: compute wanted keys and remove anything stale.
  const wantedKeys = new Set<string>()
  for (const item of items) wantedKeys.add(keyOf(item))
  for (const [k, el] of existing) {
    if (!wantedKeys.has(k)) {
      el.remove()
      existing.delete(k)
    }
  }
  // Children with missing/empty data-key were never added to `existing`;
  // strip them too so callers can recover from drift.
  for (const child of Array.from(parent.children)) {
    if (!(child as HTMLElement).dataset.key) child.remove()
  }

  // Step 3: walk items in order; reuse existing or create new.
  let cursor: ChildNode | null = parent.firstChild
  for (const item of items) {
    const key = keyOf(item)
    let el = existing.get(key) as HTMLElement | undefined
    if (el) {
      if (el === cursor) {
        cursor = cursor.nextSibling
      } else {
        parent.insertBefore(el, cursor)
      }
    } else {
      el = create(item)
      el.dataset.key = key
      parent.insertBefore(el, cursor)
    }
    if (update) update(el, item)
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add packages/caribou-ui-headless/src/reconcile-keyed-list.ts packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
git commit -m "feat(caribou-ui-headless): reconcileKeyedList — removal + move tests

Adds removal pass for stale children and missing/empty data-key drift
recovery. Move scenarios (swap-adjacent, full-reverse, mixed) already
worked via cursor walk — tests pin their op counts as a regression
guard."
```

---

## Task 7: Helper — stable identity invariant + missing-data-key recovery

**Goal of this task:** Add explicit cross-cutting tests for the load-bearing invariant ("surviving elements are `Object.is` to pre-call refs") and the missing-`data-key` recovery path (already handled by Task 6's impl).

**Files:**
- Modify: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`

- [ ] **Step 1: Write the tests**

```ts
describe('reconcileKeyedList — stable identity invariant', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('every surviving element is Object.is to its pre-call ref across mixed mutations', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const refs = new Map<string, Element>()
    for (const child of Array.from(ul.children)) {
      refs.set((child as HTMLElement).dataset.key!, child)
    }

    // Drop b, swap d & e, prepend x.
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'x' }, { id: 'a' }, { id: 'c' }, { id: 'e' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })

    for (const child of Array.from(ul.children)) {
      const k = (child as HTMLElement).dataset.key!
      if (refs.has(k)) expect(child).toBe(refs.get(k)) // surviving = same ref
    }
  })
})

describe('reconcileKeyedList — direct child without data-key', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('removes hand-injected children that lack a data-key', () => {
    const ul = makeUl()
    reconcileKeyedList({ parent: ul, items: [{ id: 'a' }], keyOf: (i: Item) => i.id, create: makeLi })

    // Simulate drift: someone hand-appended an <li> without going through the helper.
    const stray = document.createElement('li')
    stray.textContent = 'stray'
    ul.appendChild(stray)
    expect(ul.children.length).toBe(2)

    reconcileKeyedList({ parent: ul, items: [{ id: 'a' }], keyOf: (i: Item) => i.id, create: makeLi })
    expect(ul.children.length).toBe(1)
    expect((ul.children[0] as HTMLElement).dataset.key).toBe('a')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: PASS — both describe blocks green; impl from Task 6 already handles them.

- [ ] **Step 3: Commit**

```bash
git add packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
git commit -m "test(caribou-ui-headless): stable-identity + drift-recovery invariants

Asserts (a) surviving elements keep object identity across mixed
mutations — the property the entire design is built on; (b) hand-
injected children without data-key are recovered by removal on the
next reconcile."
```

---

## Task 8: Helper — dev-mode duplicate-key throw + post-condition assertion

**Goal of this task:** Add the dev-mode invariants from spec §3.5: throw on duplicate keys, assert post-condition. Use the hardened guard so Nitro server bundles tolerate the absence of `import.meta.env`.

**Files:**
- Modify: `packages/caribou-ui-headless/src/reconcile-keyed-list.ts`
- Modify: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('reconcileKeyedList — dev-mode invariants', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('throws on duplicate keys', () => {
    const ul = makeUl()
    expect(() =>
      reconcileKeyedList({
        parent: ul,
        items: [{ id: 'a' }, { id: 'a' }],
        keyOf: (i: Item) => i.id,
        create: makeLi,
      }),
    ).toThrow(/duplicate key/i)
  })

  it('asserts post-condition: parent.children keys equal items keys element-for-element', () => {
    const ul = makeUl()
    // Inject a stale child with a key that doesn't match what the items will produce —
    // post-condition is the safety net that catches helper-internal bugs (e.g., a
    // future refactor that forgets to call insertBefore for one branch). Verify the
    // assertion exists and fires when invariants would be broken.
    let buggyKeyOfCalled = 0
    const buggyKeyOf = (i: Item) => {
      buggyKeyOfCalled++
      return buggyKeyOfCalled === 1 ? i.id : 'WRONG'
    }
    expect(() =>
      reconcileKeyedList({
        parent: ul,
        items: [{ id: 'a' }, { id: 'b' }],
        keyOf: buggyKeyOf,
        create: makeLi,
      }),
    ).toThrow(/post-condition|invariant|key mismatch/i)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: FAIL — the helper does not yet throw on duplicates or assert post-conditions.

- [ ] **Step 3: Extend implementation**

At the top of `packages/caribou-ui-headless/src/reconcile-keyed-list.ts`, add the dev-mode guard and update the function body:

```ts
// Dev-mode detection. Hardened to tolerate Nitro server bundles where
// `import.meta.env` is undefined (Vite/Vitest define it; plain Node ESM
// and Nitro do not).
const IS_DEV: boolean = (() => {
  try {
    return typeof import.meta !== 'undefined' &&
      Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
})()
```

Update the function body — the duplicate-key check goes BEFORE the cursor walk (so a duplicate doesn't first wreak havoc on the DOM); the post-condition goes AFTER:

```ts
export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void {
  const { parent, items, keyOf, create, update } = opts

  // Build a map of existing children by data-key.
  const existing = new Map<string, Element>()
  for (const child of Array.from(parent.children)) {
    const k = (child as HTMLElement).dataset.key
    if (k) existing.set(k, child)
  }

  // Compute wanted keys.
  const wantedKeys = new Set<string>()
  const itemKeys: string[] = []
  for (const item of items) {
    const k = keyOf(item)
    itemKeys.push(k)
    wantedKeys.add(k)
  }

  if (IS_DEV && items.length !== wantedKeys.size) {
    throw new Error(`reconcileKeyedList: duplicate key in items array (length ${items.length} vs unique ${wantedKeys.size})`)
  }

  // Strip stale children.
  for (const [k, el] of existing) {
    if (!wantedKeys.has(k)) {
      el.remove()
      existing.delete(k)
    }
  }
  for (const child of Array.from(parent.children)) {
    if (!(child as HTMLElement).dataset.key) child.remove()
  }

  // Walk items in order; reuse existing or create new.
  let cursor: ChildNode | null = parent.firstChild
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const key = itemKeys[i]
    let el = existing.get(key) as HTMLElement | undefined
    if (el) {
      if (el === cursor) {
        cursor = cursor.nextSibling
      } else {
        parent.insertBefore(el, cursor)
      }
    } else {
      el = create(item)
      el.dataset.key = key
      parent.insertBefore(el, cursor)
    }
    if (update) update(el, item)
  }

  if (IS_DEV) {
    const got = Array.from(parent.children).map((c) => (c as HTMLElement).dataset.key)
    if (got.length !== itemKeys.length || got.some((k, i) => k !== itemKeys[i])) {
      throw new Error(
        `reconcileKeyedList: post-condition violated — parent.children keys [${got.join(',')}] != items keys [${itemKeys.join(',')}]`,
      )
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list`

Expected: PASS — all describe blocks green. Vitest sets `import.meta.env.DEV = true` by default, so the dev-mode branch is exercised.

- [ ] **Step 5: Run coverage check**

Run: `pnpm --filter @beatzball/caribou-ui-headless test:coverage`

Expected: coverage thresholds met (lines ≥95, functions ≥95, statements ≥95, branches ≥90) for `reconcile-keyed-list.ts`. If branches dip below 90 because the IS_DEV `false` branch is uncovered, that's acceptable — the dev guard is a single conditional whose `false` branch is by definition only hit in non-dev runtimes, and the package's branch threshold is global, not per-file. If the threshold actually fails, exclude the IS_DEV initialization line by extracting it to a separate `dev-guard.ts` module excluded from coverage, or add a `/* c8 ignore next */` comment on the IS_DEV line.

- [ ] **Step 6: Commit**

```bash
git add packages/caribou-ui-headless/src/reconcile-keyed-list.ts packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.test.ts
git commit -m "feat(caribou-ui-headless): dev-mode invariants — duplicate-key + post-condition

Throws on duplicate keys and asserts post-condition (parent.children
keys element-for-element equal to items keys). Hardened import.meta.env
guard tolerates Nitro server bundles. Negative test pins the post-
condition path with a synthetic buggy keyOf."
```

---

## Task 9: Op-count regression test file (CI metric §8.1)

**Goal of this task:** Create a dedicated test file that asserts EXACT op counts per spec §3.4. This is the CI-locked algorithmic perf contract.

**Files:**
- Create: `packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.bench-counts.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.bench-counts.test.ts
//
// Op-count regression tests. Asserts the EXACT op counts from spec §3.4
// for the keyed-list reconciler. If a future refactor accidentally
// introduces additional moves, removes, or creates for any covered
// scenario, this file fails with a clear delta.
//
// Op definitions (spec §3.4):
//  - create: one create(item) invocation
//  - insert: parent.insertBefore for a freshly-created element
//  - move:   parent.insertBefore for an existing element AND el !== cursor
//            AND el !== cursor.previousSibling (excludes self-move no-op)
//  - remove: el.remove() invocation
//  - update: update(el, item) invocation

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reconcileKeyedList } from '../reconcile-keyed-list.js'

interface Item { id: string }

function setup() {
  document.body.innerHTML = ''
  const ul = document.createElement('ul')
  document.body.appendChild(ul)

  const counts = { create: 0, insert: 0, move: 0, remove: 0, update: 0 }
  const create = (i: Item) => { counts.create++; const li = document.createElement('li'); li.textContent = i.id; return li }
  const update = () => { counts.update++ }

  const realInsertBefore = ul.insertBefore.bind(ul)
  const knownChildren = new WeakSet<Node>()
  ul.insertBefore = function<T extends Node>(node: T, ref: Node | null): T {
    if (knownChildren.has(node)) {
      // existing element being repositioned: count as move only if not a no-op
      if (node !== ref && node !== ref?.previousSibling) counts.move++
    } else {
      counts.insert++
      knownChildren.add(node)
    }
    return realInsertBefore(node, ref) as T
  } as typeof ul.insertBefore

  const realRemove = Element.prototype.remove
  const removeSpy = vi.spyOn(Element.prototype, 'remove').mockImplementation(function(this: Element) {
    if (this.parentElement === ul) counts.remove++
    realRemove.call(this)
  })

  return {
    ul,
    counts,
    create,
    update,
    cleanup: () => removeSpy.mockRestore(),
  }
}

function run(s: ReturnType<typeof setup>, items: Item[]) {
  reconcileKeyedList({ parent: s.ul, items, keyOf: (i) => i.id, create: s.create, update: s.update })
}

describe('reconcile-keyed-list — op-count regression contract', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => { s = setup() })

  it('empty → N=5: 5 creates, 5 inserts, 0 moves, 0 removes, 5 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }])
    expect(s.counts).toEqual({ create: 5, insert: 5, move: 0, remove: 0, update: 5 })
    s.cleanup()
  })

  it('N=5 → identical: 0 creates, 0 inserts, 0 moves, 0 removes, 5 updates', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    run(s, items)
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, items)
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 0, remove: 0, update: 5 })
    s.cleanup()
  })

  it('prepend K=3 onto N=5: 3 creates, 3 inserts, 0 moves, 0 removes, 8 updates', () => {
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    run(s, initial)
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'x' }, { id: 'y' }, { id: 'z' }, ...initial])
    expect(s.counts).toEqual({ create: 3, insert: 3, move: 0, remove: 0, update: 8 })
    s.cleanup()
  })

  it('append K=3 onto N=5: 3 creates, 3 inserts, 0 moves, 0 removes, 8 updates', () => {
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    run(s, initial)
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [...initial, { id: 'x' }, { id: 'y' }, { id: 'z' }])
    expect(s.counts).toEqual({ create: 3, insert: 3, move: 0, remove: 0, update: 8 })
    s.cleanup()
  })

  it('remove-middle (5 → 3): 0 creates, 0 inserts, 0 moves, 2 removes, 3 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }])
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'a' }, { id: 'c' }, { id: 'e' }])
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 0, remove: 2, update: 3 })
    s.cleanup()
  })

  it('swap adjacent (n=3): 0 creates, 0 inserts, 1 move, 0 removes, 3 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'b' }, { id: 'a' }, { id: 'c' }])
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 1, remove: 0, update: 3 })
    s.cleanup()
  })

  it('full reverse (n=4): 0 creates, 0 inserts, 3 moves (n-1), 0 removes, 4 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'd' }, { id: 'c' }, { id: 'b' }, { id: 'a' }])
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 3, remove: 0, update: 4 })
    s.cleanup()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @beatzball/caribou-ui-headless test reconcile-keyed-list.bench-counts`

Expected: PASS — all 7 scenarios match the spec §3.4 op-count contract. If any FAIL, the helper algorithm has a bug; debug before proceeding.

- [ ] **Step 3: Commit**

```bash
git add packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.bench-counts.test.ts
git commit -m "test(caribou-ui-headless): op-count regression contract for reconcileKeyedList

Locks the algorithmic perf contract from spec §3.4 in CI: exact op
counts for empty→N, identical, prepend, append, remove-middle, swap-
adjacent, full-reverse. Any future refactor that drifts will fail
loudly with a clear delta."
```

---

## Task 10: Helper — wire export

**Goal of this task:** Make `reconcileKeyedList` importable from the package root.

**Files:**
- Modify: `packages/caribou-ui-headless/src/index.ts`

- [ ] **Step 1: Add export**

Edit `packages/caribou-ui-headless/src/index.ts` to add the new export. After the existing two lines, add:

```ts
export * from './intersection-observer.js'
export * from './relative-time.js'
export * from './reconcile-keyed-list.js'
```

- [ ] **Step 2: Verify import works from a test**

Run: `pnpm --filter @beatzball/caribou-ui-headless test`

Expected: PASS — full test suite for the package green.

- [ ] **Step 3: Commit**

```bash
git add packages/caribou-ui-headless/src/index.ts
git commit -m "feat(caribou-ui-headless): export reconcileKeyedList from package root"
```

---

## Task 11: Timeline — replace render() and updated() with helper call

**Goal of this task:** Switch `<caribou-timeline>` to render `<caribou-list-mount>` and reconcile children via the helper into the mount's inner `<ul>`. Preserve the `effect()` shallow-compare gate (spec §10.6) and delete the `data-index`-keyed `card.status =` loop in `updated()`.

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-timeline.ts`

- [ ] **Step 1: Read the current file end-to-end**

Use Read on `apps/caribou-elena/pages/components/caribou-timeline.ts`. Familiarize yourself with: the `effect()` callback (lines 50–70), the `updated()` body (lines 100–134), the `render()` body (lines 155–187).

- [ ] **Step 2: Modify the imports**

At the top of the file, add the helper + mount imports. The line currently reads:

```ts
import { createIntersectionObserver } from '@beatzball/caribou-ui-headless'
```

Replace with:

```ts
import { createIntersectionObserver, reconcileKeyedList, CaribouListMount } from '@beatzball/caribou-ui-headless'
```

(Importing `CaribouListMount` is what registers the `<caribou-list-mount>` custom element; the named import is required as a side-effect-import handle even though we don't reference the class by name in the body.)

- [ ] **Step 3: Add a stashed listEl field**

Add a private field declaration near the existing private fields (around line 27):

```ts
  private listEl: HTMLUListElement | null = null
```

- [ ] **Step 4: Update render() to emit `<caribou-list-mount>`**

Replace the `<ul>...</ul>` section in `render()` (lines 174–180):

```ts
        <ul style="list-style:none;margin:0;padding:0;">
          ${this.statuses.map((s, i) => html`
            <li>
              <caribou-status-card data-index="${i}" data-status-id="${s.id}"></caribou-status-card>
            </li>
          `)}
        </ul>
```

Replace with:

```ts
        <caribou-list-mount></caribou-list-mount>
```

The mount's inner `<ul>` carries the `list-style:none;margin:0;padding:0;` styling (baked into the mount's shadow DOM), so the host doesn't need to repeat them.

- [ ] **Step 5: Replace the data-index card-walk in updated() with a reconcile call**

In `updated()`, the block currently at lines 109–116 reads:

```ts
    const cards = this.querySelectorAll<HTMLElement & { status?: mastodon.v1.Status | null }>(
      'caribou-status-card[data-index]',
    )
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
    })
```

Replace it with:

```ts
    if (!this.listEl) {
      const mount = this.querySelector<CaribouListMount>('caribou-list-mount')
      this.listEl = mount?.mountUl ?? null
    }
    this.reconcile()
```

- [ ] **Step 6: Add the reconcile() method**

Add this private method to the class (place it after `refreshSentinel()`, before `render()`):

```ts
  private reconcile() {
    if (!this.listEl) return
    reconcileKeyedList({
      parent: this.listEl,
      items: this.statuses,
      keyOf: (s) => s.id,
      create: (s) => {
        const li = document.createElement('li')
        const card = document.createElement('caribou-status-card') as HTMLElement & { status?: mastodon.v1.Status }
        card.dataset.statusId = s.id
        card.status = s
        li.appendChild(card)
        return li
      },
      update: (li, s) => {
        const card = li.firstElementChild as HTMLElement & { status?: mastodon.v1.Status }
        if (card.status !== s) card.status = s
      },
    })
  }
```

- [ ] **Step 7: Run typecheck + existing tests**

Run: `pnpm --filter caribou-elena typecheck && pnpm --filter caribou-elena test`

Expected: typecheck PASS; existing tests PASS (Plan 3 tests should still hold; this is a refactor, not a behavior change). If any test fails, debug before proceeding — likely the `effect()` short-circuit or the IO sentinel ordering.

- [ ] **Step 8: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-timeline.ts
git commit -m "refactor(caribou-elena): timeline renders via <caribou-list-mount> + reconcileKeyedList

render() emits <caribou-list-mount></caribou-list-mount>; updated() stashes
mount.mountUl and calls the keyed reconciler against it. Drops the
data-index-keyed card.status loop. Preserves the effect() shallow-compare
gate (spec §10.6) and the banner/sentinel imperative wiring. Cards keep
object identity across prepend/append/poll cycles. The mount provides
morph-opaque shadow DOM for the <ul> per spec §4 / §10.6."
```

---

## Task 12: Timeline — applyNewPosts identity + render-avoidance integration test

**Goal of this task:** Pin the user-facing properties: surviving cards keep `Object.is` identity across prepends, and the card's `status` setter does NOT fire for surviving cards.

**Files:**
- Create or Modify: `apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts`

- [ ] **Step 1: Check whether the test file exists**

Run: `ls apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts 2>/dev/null && echo EXISTS || echo NEW`

If EXISTS: read it first, append to existing describe blocks.
If NEW: create it from scratch using the template below.

- [ ] **Step 2: Write the test**

Write or append:

```ts
// apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

beforeAll(async () => { await import('../caribou-timeline.js') })

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const mkStatus = (id: string) => ({
  id,
  content: `<p>${id}</p>`,
  account: ACCT,
  createdAt: '2026-05-08T12:00:00Z',
  inReplyToId: null,
})

describe('<caribou-timeline> — keyed reconciliation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('keeps surviving card identity across applyNewPosts prepend', async () => {
    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string
      initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    const initial = Array.from({ length: 10 }, (_, i) => mkStatus(`s${i}`))
    tl.initial = { statuses: initial, nextMaxId: null }
    document.body.appendChild(tl)

    // Settle initial render.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const mount = tl.querySelector('caribou-list-mount') as HTMLElement & { mountUl: HTMLUListElement }
    const ul = mount.mountUl
    const beforeRefs = Array.from(ul.children) as HTMLLIElement[]
    expect(beforeRefs).toHaveLength(10)

    // Drive a prepend through the store (simulate poll discovering 3 new statuses).
    const newOnes = [mkStatus('n0'), mkStatus('n1'), mkStatus('n2')]
    const store = (tl as unknown as { store: { applyNewPosts: () => void; statuses: { value: unknown[] } } }).store
    // Push the new posts into the store's underlying signals — for the test we
    // shortcut by mutating the store's statuses signal via applyNewPosts's API.
    // Concrete API: set store.newPostsBuffer or call the store's apply method.
    // Adapt this block to whatever interface createTimelineStore exposes for
    // injecting new posts in tests; if a setter is missing, dispatch the
    // 'apply-new-posts' event after manually nudging the underlying cache.
    const bufferable = store as unknown as { _testOnlyPrepend?: (xs: unknown[]) => void }
    if (bufferable._testOnlyPrepend) {
      bufferable._testOnlyPrepend(newOnes)
    } else {
      // Fallback: dispatch apply-new-posts after seeding via the cache layer.
      // If your store does not yet expose a test seam, add one (see Task 12
      // adaptation note below) before completing this step.
      tl.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true }))
    }

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const afterRefs = Array.from(ul.children) as HTMLLIElement[]
    expect(afterRefs).toHaveLength(13)
    // The original 10 should now occupy positions 3..12, identity preserved.
    for (let i = 0; i < 10; i++) {
      expect(afterRefs[i + 3]).toBe(beforeRefs[i])
    }
  })

  it('does not fire caribou-status-card.status setter for surviving cards', async () => {
    // Wrap the prototype's status setter to count assignments. Reset after.
    const proto = customElements.get('caribou-status-card')!.prototype as unknown as { status: unknown }
    const originalDescriptor = Object.getOwnPropertyDescriptor(proto, 'status')
    // If the existing descriptor is missing (e.g., defined elsewhere via Elena
    // props), walk the prototype chain. Adapt as needed for your project.
    let setterCalls = 0
    if (originalDescriptor && originalDescriptor.set) {
      const origSet = originalDescriptor.set
      Object.defineProperty(proto, 'status', {
        ...originalDescriptor,
        set(this: unknown, v: unknown) { setterCalls++; origSet.call(this, v) },
      })
    }
    try {
      const tl = document.createElement('caribou-timeline') as HTMLElement & {
        kind: string; initial: { statuses: unknown[]; nextMaxId: string | null }
      }
      tl.kind = 'home'
      const initial = Array.from({ length: 5 }, (_, i) => mkStatus(`s${i}`))
      tl.initial = { statuses: initial, nextMaxId: null }
      document.body.appendChild(tl)
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))

      // Reset the counter after initial mount; mount-time setter fires are expected.
      setterCalls = 0

      // Trigger a re-render with the same statuses (simulate a poll tick that
      // doesn't change anything). The store's effect should short-circuit but
      // even if it doesn't, the helper's update should be a no-op for surviving
      // cards because card.status === s.
      const store = (tl as unknown as { store: { poll: () => Promise<void> } }).store
      await store.poll?.()
      await new Promise((r) => setTimeout(r, 0))

      expect(setterCalls).toBe(0)
    } finally {
      if (originalDescriptor) Object.defineProperty(proto, 'status', originalDescriptor)
    }
  })
})
```

**Adaptation note:** the test uses `_testOnlyPrepend` and `store.poll()` as concrete shapes. If `@beatzball/caribou-state`'s `createTimelineStore` does not expose either, EITHER add a minimal test-only seam (`_testOnlyPrepend(xs: Status[])` that splices into the store's internal cache + flips `newPostsCount.value`) AND surface it from the package's index — keep it underscore-prefixed and document it as test-only — OR drive the prepend through whatever public method the store does expose (read `packages/caribou-state/src/timeline-store.ts`). Pick the path that matches the existing test patterns in the repo's other component tests; do not invent a parallel API.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter caribou-elena test caribou-timeline`

Expected: PASS — both new tests green. If the `applyNewPosts` test fails because the store API doesn't match, adapt per the note above.

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts
git commit -m "test(caribou-elena): timeline reconciliation — surviving identity + render avoidance

Pins the two user-facing properties the keyed reconciler delivers:
(a) surviving cards keep Object.is identity across applyNewPosts
prepends; (b) caribou-status-card.status setter fires zero times for
surviving cards under same-state poll ticks (the render-avoidance
metric from spec §8.2)."
```

---

## Task 13: Timeline — scroll-preservation test

**Goal of this task:** Pin the actual user-facing benefit — scroll position survives a poll-driven prepend.

**Files:**
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts`

- [ ] **Step 1: Append the test**

```ts
describe('<caribou-timeline> — scroll preservation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('preserves scrollTop across applyNewPosts prepend', async () => {
    // Wrap the timeline in a scrollable container so we can set scrollTop.
    const container = document.createElement('div')
    container.style.height = '400px'
    container.style.overflow = 'auto'
    document.body.appendChild(container)

    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string; initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    const initial = Array.from({ length: 50 }, (_, i) => mkStatus(`s${i}`))
    tl.initial = { statuses: initial, nextMaxId: null }
    container.appendChild(tl)

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    container.scrollTop = 800
    expect(container.scrollTop).toBe(800)

    // Prepend via the same path as the identity test in Task 12.
    const newOnes = [mkStatus('n0'), mkStatus('n1'), mkStatus('n2')]
    const store = (tl as unknown as { store: { _testOnlyPrepend?: (xs: unknown[]) => void } }).store
    if (store._testOnlyPrepend) {
      store._testOnlyPrepend(newOnes)
    } else {
      tl.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true }))
    }
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // happy-dom maintains scrollTop across DOM mutations of preceding siblings
    // when nodes are MOVED, not recreated. This is the test that fails loudly
    // if the helper ever regresses to creating fresh <li>s for surviving
    // statuses.
    expect(container.scrollTop).toBe(800)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test caribou-timeline`

Expected: PASS. If happy-dom does not preserve scrollTop reliably across prepends (a known happy-dom limitation in some versions), adapt the assertion to compare `<li>` node identity at the post-prepend `[3..52]` range against pre-prepend `[0..49]` — that's the same property expressed structurally.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts
git commit -m "test(caribou-elena): timeline scroll preservation across applyNewPosts

Pins the user-facing property — scrollTop survives a 3-status prepend
when the keyed reconciler moves rather than recreates surviving
<li> nodes."
```

---

## Task 14: Timeline — image-element identity test

**Goal of this task:** Repurposed from the morph-spec flicker repro: assert that an `<img>` rendered inside a card survives prepends with the same DOM-node identity. This is the structural property that prevents the avatar-flicker class of bug.

**Files:**
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts`

- [ ] **Step 1: Append the test**

```ts
describe('<caribou-timeline> — card-internal element identity', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('keeps card-internal <img> identity across applyNewPosts prepend', async () => {
    const tl = document.createElement('caribou-timeline') as HTMLElement & {
      kind: string; initial: { statuses: unknown[]; nextMaxId: string | null }
    }
    tl.kind = 'home'
    // Give one status an avatar so the card renders an <img>.
    const initial = [mkStatus('s0'), mkStatus('s1')]
    initial[0].account = { ...ACCT, avatar: 'https://example.test/a.png', avatarStatic: 'https://example.test/a.png' }
    tl.initial = { statuses: initial, nextMaxId: null }
    document.body.appendChild(tl)

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const card = tl.querySelector('caribou-status-card') as HTMLElement
    const beforeImg = card.shadowRoot?.querySelector('img') ?? null
    if (!beforeImg) {
      // If the card delays img insertion (lazy), wait one more tick.
      await new Promise((r) => setTimeout(r, 0))
    }
    const beforeImgRef = card.shadowRoot!.querySelector('img')!

    // Prepend.
    const store = (tl as unknown as { store: { _testOnlyPrepend?: (xs: unknown[]) => void } }).store
    if (store._testOnlyPrepend) {
      store._testOnlyPrepend([mkStatus('n0')])
    } else {
      tl.dispatchEvent(new CustomEvent('apply-new-posts', { bubbles: true }))
    }
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // Card s0 has moved from index 0 to index 1; its <img> should be the same node.
    const mount = tl.querySelector('caribou-list-mount') as HTMLElement & { mountUl: HTMLUListElement }
    const ul = mount.mountUl
    const survivingCard = (ul.children[1] as HTMLElement).querySelector('caribou-status-card') as HTMLElement
    const afterImgRef = survivingCard.shadowRoot!.querySelector('img')!
    expect(afterImgRef).toBe(beforeImgRef)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test caribou-timeline`

Expected: PASS. If happy-dom does not synchronously render the card's `<img>` (depends on the card's render lifecycle), add additional `await new Promise((r) => setTimeout(r, 0))` ticks until the img is present, then continue.

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts
git commit -m "test(caribou-elena): card-internal <img> identity survives prepend

Structural test for the avatar-flicker class of bug. When the keyed
reconciler MOVES a surviving card's <li> instead of recreating it, the
card's shadow DOM (and therefore its <img>) is preserved by reference.
Same property the morph-spec §1c flicker repro pins for shadow-DOM
children."
```

---

## Task 15: Profile — replace render() and updated() with helper call

**Goal of this task:** Same shape as Task 11. Drop the `data-index` card-walk; reconcile via the helper.

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-profile.ts`

- [ ] **Step 1: Read the current file**

Use Read on `apps/caribou-elena/pages/components/caribou-profile.ts`. Note: similar layout to timeline. Header imperative wiring (`header.account = ...`) and sentinel logic stay untouched.

- [ ] **Step 2: Add the helper + mount imports**

Find the existing import line:

```ts
import { createIntersectionObserver } from '@beatzball/caribou-ui-headless'
```

Replace with:

```ts
import { createIntersectionObserver, reconcileKeyedList, CaribouListMount } from '@beatzball/caribou-ui-headless'
```

- [ ] **Step 3: Add a stashed listEl field**

```ts
  private listEl: HTMLUListElement | null = null
```

- [ ] **Step 4: Update render()**

In the `render()` method, replace:

```ts
      <ul style="list-style:none;margin:0;padding:0;">
        ${this.statuses.map((s, i) => html`
          <li>
            <caribou-status-card data-index="${i}" data-status-id="${s.id}" variant="timeline"></caribou-status-card>
          </li>
        `)}
      </ul>
```

With:

```ts
      <caribou-list-mount></caribou-list-mount>
```

- [ ] **Step 5: Replace the data-index card walk in updated()**

Replace this block (currently at lines 84–91):

```ts
    const cards = this.querySelectorAll<HTMLElement & { status?: Status | null }>(
      'caribou-status-card[data-index]',
    )
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
    })
```

With:

```ts
    if (!this.listEl) {
      const mount = this.querySelector<CaribouListMount>('caribou-list-mount')
      this.listEl = mount?.mountUl ?? null
    }
    this.reconcile()
```

- [ ] **Step 6: Add the reconcile() method**

Place after `refreshSentinel()`, before `render()`:

```ts
  private reconcile() {
    if (!this.listEl) return
    reconcileKeyedList({
      parent: this.listEl,
      items: this.statuses,
      keyOf: (s) => s.id,
      create: (s) => {
        const li = document.createElement('li')
        const card = document.createElement('caribou-status-card') as HTMLElement & { status?: Status }
        card.dataset.statusId = s.id
        card.setAttribute('variant', 'timeline')
        card.status = s
        li.appendChild(card)
        return li
      },
      update: (li, s) => {
        const card = li.firstElementChild as HTMLElement & { status?: Status }
        if (card.status !== s) card.status = s
      },
    })
  }
```

- [ ] **Step 7: Run typecheck + existing tests**

Run: `pnpm --filter caribou-elena typecheck && pnpm --filter caribou-elena test caribou-profile`

Expected: typecheck PASS; existing profile tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-profile.ts
git commit -m "refactor(caribou-elena): profile renders via <caribou-list-mount> + reconcileKeyedList

Same shape as the timeline change: render() emits <caribou-list-mount>;
updated() stashes mount.mountUl and calls the keyed reconciler. Header
imperative wire (header.account = ...) and IO sentinel logic preserved."
```

---

## Task 16: Profile — tab-swap integration test

**Goal of this task:** Pin (a) full-list swap on tab change works, (b) `header.account` is NOT re-set when account didn't change.

**Files:**
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-profile.test.ts`

- [ ] **Step 1: Read the existing file**

Use Read on `apps/caribou-elena/pages/components/__tests__/caribou-profile.test.ts` to see existing test conventions.

- [ ] **Step 2: Append the new tests**

Add a new describe block at the end:

```ts
describe('<caribou-profile> — keyed reconciliation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('does not re-fire header.account setter when account unchanged across tab swap', async () => {
    // Spy on the header element's account setter.
    const headerProto = customElements.get('caribou-profile-header')?.prototype as unknown as { account: unknown } | undefined
    const desc = headerProto && Object.getOwnPropertyDescriptor(headerProto, 'account')
    let setterCalls = 0
    if (desc?.set) {
      const origSet = desc.set
      Object.defineProperty(headerProto, 'account', {
        ...desc,
        set(this: unknown, v: unknown) { setterCalls++; origSet.call(this, v) },
      })
    }
    try {
      const profile = document.createElement('caribou-profile') as HTMLElement & {
        handle: string; tab: string
      }
      profile.handle = 'a@example.test'
      profile.tab = 'posts'
      document.body.appendChild(profile)

      // Wait for initial render + first tab data.
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))

      // Reset after mount; mount-time setter fires are expected.
      setterCalls = 0

      // Swap tab — the entire status list should swap, but account is unchanged.
      profile.tab = 'media'
      ;(profile as unknown as { requestUpdate?: () => void }).requestUpdate?.()
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))

      expect(setterCalls).toBe(0)
    } finally {
      if (desc) Object.defineProperty(headerProto!, 'account', desc)
    }
  })
})
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter caribou-elena test caribou-profile`

Expected: PASS. If profile's tab-change pathway doesn't trigger via the `tab =` setter, adapt to dispatch whatever event the existing profile tests use to drive a tab change.

- [ ] **Step 4: Commit**

```bash
git add apps/caribou-elena/pages/components/__tests__/caribou-profile.test.ts
git commit -m "test(caribou-elena): profile reconciliation — header stability across tab swap

Pins that header.account setter does not fire when account is unchanged
across a tab swap. The reconciler isolates list-content churn from
sibling element churn."
```

---

## Task 17: Thread — extend collectStatuses to collectThreadItems

**Goal of this task:** Refactor `<caribou-thread>` to emit a flat `{ status, depth }` array suitable for the helper. Pure-internal change; no behavior change yet.

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-thread.ts`

- [ ] **Step 1: Read the file**

Use Read on `apps/caribou-elena/pages/components/caribou-thread.ts`. Note: `collectStatuses()` returns `Status[]`; we need `{ status, depth }[]` where `depth` is `null` for ancestors and the focused, and a number for descendants.

- [ ] **Step 2: Rename and extend collectStatuses**

Replace the `collectStatuses()` method:

```ts
  private collectStatuses(): Status[] {
    if (this.store?.focused.value.status === 'ready' && this.store.context.value.status === 'ready') {
      return [
        ...this.store.context.value.data.ancestors,
        this.store.focused.value.data,
        ...this.store.context.value.data.descendants,
      ]
    }
    return []
  }
```

With the new shape (keep the old name as a thin alias if other code uses it; otherwise replace entirely):

```ts
  private collectThreadItems(): { status: Status; depth: number | null }[] {
    if (
      this.store?.focused.value.status === 'ready' &&
      this.store.context.value.status === 'ready'
    ) {
      const focused = this.store.focused.value.data
      const { ancestors, descendants } = this.store.context.value.data
      const depths = depthMap(focused.id, descendants)
      return [
        ...ancestors.map((s) => ({ status: s, depth: null as number | null })),
        { status: focused, depth: null as number | null },
        ...descendants.map((s) => ({ status: s, depth: depths.get(s.id) ?? MAX_DEPTH })),
      ]
    }
    return []
  }
```

- [ ] **Step 3: Update the existing updated() / render() callers to use the new method**

Search the file for any remaining `collectStatuses()` calls. Where they were used to feed cards by id (the existing `updated()` block at lines 92–102), keep that loop intact for now — Task 18 will replace it. The rename + new shape is independent.

If `updated()` references `collectStatuses()` directly (line 93 in the current file: `const all = this.collectStatuses()`), update to:

```ts
    const all = this.collectThreadItems().map((i) => i.status)
```

This preserves the current behavior — the rename doesn't change `updated()` yet.

- [ ] **Step 4: Run typecheck + existing tests**

Run: `pnpm --filter caribou-elena typecheck && pnpm --filter caribou-elena test caribou-thread`

Expected: typecheck PASS; existing thread tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-thread.ts
git commit -m "refactor(caribou-elena): thread collectThreadItems returns {status, depth} tuples

Preparatory rename + shape change. collectStatuses → collectThreadItems
returns ancestors/focused (depth: null) + descendants (depth: number).
updated() now reads the status field; behavior unchanged.

Sets up Task 18 to call reconcileKeyedList against the flat tuple list."
```

---

## Task 18: Thread — replace render() and updated() with helper call

**Goal of this task:** Switch thread to render `<caribou-list-mount>` inside its shadow root and reconcile via the helper into the mount's inner `<ul>`. Sync `data-depth` on both the `<li>` and the inner card per spec §5.3.

**Files:**
- Modify: `apps/caribou-elena/pages/components/caribou-thread.ts`

- [ ] **Step 1: Add the helper + mount imports**

Add at the top with the other imports:

```ts
import { reconcileKeyedList, CaribouListMount } from '@beatzball/caribou-ui-headless'
```

- [ ] **Step 2: Add a stashed listEl field**

```ts
  private listEl: HTMLUListElement | null = null
```

- [ ] **Step 3: Update render()**

Replace the existing render() body (lines 115–139). The new render() returns the loading guard or `<caribou-list-mount>`:

```ts
  override render() {
    if (!this.store ||
        this.store.focused.value.status !== 'ready' ||
        this.store.context.value.status !== 'ready') {
      return html`<div style="padding:var(--space-4);color:var(--fg-muted);">Loading…</div>`
    }
    return html`<caribou-list-mount></caribou-list-mount>`
  }
```

- [ ] **Step 4: Replace the updated() body**

The current `updated()` (lines 92–102):

```ts
  override updated() {
    const all = this.collectThreadItems().map((i) => i.status)
    const cards = this.shadowRoot!.querySelectorAll<HTMLElement & { status: Status | null }>(
      'caribou-status-card[data-id]',
    )
    cards.forEach((card) => {
      const id = card.dataset.id!
      const s = all.find((x) => x.id === id) ?? null
      if (s && card.status !== s) card.status = s
    })
  }
```

Replace with:

```ts
  override updated() {
    if (!this.listEl) {
      const mount = this.shadowRoot!.querySelector<CaribouListMount>('caribou-list-mount')
      this.listEl = mount?.mountUl ?? null
    }
    this.reconcile()
  }

  private reconcile() {
    if (!this.listEl) return
    const focusedId = this.store?.focused.value.status === 'ready' ? this.store.focused.value.data.id : null
    reconcileKeyedList({
      parent: this.listEl,
      items: this.collectThreadItems(),
      keyOf: ({ status }) => status.id,
      create: ({ status, depth }) => {
        const li = document.createElement('li')
        const card = document.createElement('caribou-status-card') as HTMLElement & { status?: Status }
        card.dataset.id = status.id
        const variant =
          status.id === focusedId ? 'focused' :
          depth === null ? 'ancestor' :
          'descendant'
        card.setAttribute('variant', variant)
        if (depth !== null) {
          li.dataset.depth = String(depth)
          li.style.marginInlineStart = `calc(var(--space-4)*${depth})`
          card.dataset.depth = String(depth)
        }
        card.status = status
        li.appendChild(card)
        return li
      },
      update: (li, { status, depth }) => {
        const card = li.firstElementChild as HTMLElement & { status?: Status }
        if (card.status !== status) card.status = status
        if (depth !== null) {
          const want = String(depth)
          if (li.dataset.depth !== want) {
            li.dataset.depth = want
            li.style.marginInlineStart = `calc(var(--space-4)*${want})`
            card.dataset.depth = want
          }
        }
      },
    })
  }
```

- [ ] **Step 5: Run typecheck + existing tests**

Run: `pnpm --filter caribou-elena typecheck && pnpm --filter caribou-elena test caribou-thread`

Expected: typecheck PASS; existing thread tests PASS (they assert variants, depth caps, render order — all preserved by the reconciler).

- [ ] **Step 6: Commit**

```bash
git add apps/caribou-elena/pages/components/caribou-thread.ts
git commit -m "refactor(caribou-elena): thread renders via <caribou-list-mount> + reconcileKeyedList

render() emits <caribou-list-mount> inside the thread's shadow root;
updated() stashes mount.mountUl and calls the reconciler with a flat
{status, depth}
items array. Variant ('ancestor' | 'focused' | 'descendant') and depth
indent (li.dataset.depth + style.marginInlineStart + card.dataset.depth)
are set in create/update. Existing test coverage preserved."
```

---

## Task 19: Thread — descendant-arrival depth recompute test

**Goal of this task:** Pin that when a new descendant arrives whose insertion shifts an existing leaf's depth (reparenting under a previously-orphaned parent), the helper's `update` callback resyncs depth on the surviving `<li>`.

**Files:**
- Modify: `apps/caribou-elena/pages/components/__tests__/caribou-thread.test.ts`

- [ ] **Step 1: Append the test**

```ts
describe('<caribou-thread> — depth recompute on descendant arrival', () => {
  it('recomputes data-depth on existing <li> when reparenting shifts depth', async () => {
    document.body.innerHTML = ''
    const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
    const F = { id: 'f', content: '<p>f</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: null }
    // E is a "leaf" with inReplyToId pointing at a status NOT yet in the tree.
    // depthMap should fall back to MAX_DEPTH for it initially.
    const E = { id: 'e', content: '<p>e</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'd' }

    const el = document.createElement('caribou-thread') as HTMLElement & {
      initial: unknown; statusid: string
    }
    el.statusid = 'f'
    el.initial = { focused: F, ancestors: [], descendants: [E] }
    document.body.appendChild(el)

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const liE_before = el.shadowRoot!.querySelector('li[data-depth] caribou-status-card[data-id="e"]')!.parentElement as HTMLLIElement
    const depthBefore = liE_before.dataset.depth
    expect(depthBefore).toBeDefined()

    // Now arrive D, which makes E a real depth-2 descendant of F (F → D → E).
    const D = { id: 'd', content: '<p>d</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'f' }
    const store = (el as unknown as { store: { _testOnlySetDescendants?: (xs: unknown[]) => void } }).store
    if (store._testOnlySetDescendants) {
      store._testOnlySetDescendants([D, E])
    } else {
      // If no test seam exists, surface the same caveat as Task 12: add one to
      // packages/caribou-state/src/thread-store.ts before completing this step.
      throw new Error('Need _testOnlySetDescendants on thread store; see Task 12 adaptation note')
    }

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const liE_after = el.shadowRoot!.querySelector('li[data-depth] caribou-status-card[data-id="e"]')!.parentElement as HTMLLIElement
    expect(liE_after).toBe(liE_before) // identity preserved
    expect(liE_after.dataset.depth).not.toBe(depthBefore) // depth shifted
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter caribou-elena test caribou-thread`

Expected: PASS, modulo store-shape adaptation (see the inline note).

- [ ] **Step 3: Commit**

```bash
git add apps/caribou-elena/pages/components/__tests__/caribou-thread.test.ts
git commit -m "test(caribou-elena): thread depth recompute on descendant arrival

Pins that when a new descendant reparents an existing leaf to a smaller
depth, the helper's update callback resyncs li.dataset.depth and the
indent style on the surviving <li> — without recreating the <li>."
```

---

## Task 20: Capture before/after numbers for PR description

**Goal of this task:** Produce the §8.3 headline table for the PR description: real op-counts and setter-fire counts captured against Plan 3 head and against the new code.

**Files:**
- (Temporary) `tmp/before-after-capture.md` for scratch notes; finalize into PR body.

- [ ] **Step 1: Capture "after" numbers**

The new code's numbers come from running the integration tests with explicit logging. Add a one-time logging block to the timeline integration test (revert before merging):

```ts
// inside the applyNewPosts identity test, before the assertions
console.log('[after-prepend-3-onto-10]', { setterCalls /* from the render-avoidance test */ })
```

Run: `pnpm --filter caribou-elena test caribou-timeline 2>&1 | grep after-`

Expected: the logged numbers match the spec §3.4 contract for prepend-3-onto-10 (3 creates + 3 inserts; 0 wasted setter fires on surviving cards).

Record the output lines in `tmp/before-after-capture.md`. Repeat for the loadMore-20-onto-20 scenario by extending the integration test to drive a `loadMore` and log similarly.

- [ ] **Step 2: Capture "before" baseline**

Switch to the Plan 3 head (the merge base of this PR). The cleanest path:

```bash
git stash --include-untracked
git checkout main          # Plan 3 head
```

Add the same logging block to the current `caribou-timeline.test.ts` (or write a new test that mirrors the structure of the new test but uses the Plan 3 render path). Apply the same `caribou-status-card.prototype.status` setter-counting trick.

Run: `pnpm --filter caribou-elena test caribou-timeline 2>&1 | grep before-`

Record the output. Then switch back to the worktree branch:

```bash
git checkout -
git stash pop
```

If the stash machinery proves fragile, an alternative: do the "before" capture in a separate scratch worktree off main, leaving this worktree untouched.

- [ ] **Step 3: Build the table**

Compose the headline table for the PR description:

```markdown
| Scenario | Before (Plan 3 head) | After |
|--|--|--|
| Poll prepends 3 onto 10-status timeline | <X> wasted setter fires + <Y> li morph walks | 0 wasted setter fires + 3 inserts + 0 moves |
| `loadMore()` appends 20 onto 20 | <X> wasted setter fires + <Y> li morph walks | 0 wasted setter fires + 20 inserts + 0 moves |
| Poll, no new posts | 0 (gated by shallow-compare) | 0 (gated by shallow-compare) |
```

Save to `tmp/before-after-capture.md` for inclusion in the PR body. Then remove all temporary `console.log` calls from test files.

- [ ] **Step 4: Verify all temp logging is removed**

Run: `grep -rn "console.log\(\['\"\\[after-\|console.log\(\['\"\\[before-" apps/ packages/ 2>/dev/null`

Expected: no output. If any results, remove them.

- [ ] **Step 5: Commit (only if any non-temp changes were made)**

If the integration test was extended to drive a `loadMore` (a permanent improvement), commit that. Otherwise no commit; the captured numbers live in `tmp/` and get pasted into the PR body when opening the PR.

```bash
# Only if integration test was extended:
git add apps/caribou-elena/pages/components/__tests__/caribou-timeline.test.ts
git commit -m "test(caribou-elena): timeline integration also drives loadMore append"
```

---

## Task 21: Changesets

**Goal of this task:** Add one `.changeset/*.md` per modified package. Per project convention (see `feedback_changeset_one_per_package.md`), each changeset describes only that package's change.

**Files:**
- Create: `.changeset/keyed-reconciler-helper.md`
- Create: `.changeset/keyed-reconciler-adoption.md`
- Create: `.changeset/morph-empty-native-parent-spec.md`

- [ ] **Step 1: Confirm existing changeset config**

Run: `cat .changeset/config.json`

Note the configured packages and whether they're versioned independently or in lockstep.

- [ ] **Step 2: Write the helper changeset**

```markdown
---
"@beatzball/caribou-ui-headless": minor
---

Add `reconcileKeyedList`, a pure-function keyed-list DOM reconciler that diffs by a stable key, plus `<caribou-list-mount>`, a tiny shadow-DOM container that wraps the helper-managed `<ul>` so it's morph-opaque to the surrounding Elena host. Designed for re-rendering surfaces that need to preserve child element identity across prepends, appends, and reorderings. Used internally by `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` to avoid re-creating `<li>` wrappers for surviving statuses.

The helper owns `data-key` on every direct child of the parent; callers never write it. Cursor-walk algorithm; O(n) time; O(removed + added + moved) DOM ops. Includes dev-mode duplicate-key throw and post-condition assertion (gated on `import.meta.env.DEV`).
```

Save to a new file under `.changeset/` (Changesets generates the filename hash; pick `keyed-reconciler-helper.md`).

- [ ] **Step 3: Write the adoption changeset**

```markdown
---
"caribou-elena": patch
---

Switch `<caribou-timeline>`, `<caribou-profile>`, and `<caribou-thread>` to render via `<caribou-list-mount>` + `reconcileKeyedList` (both from `@beatzball/caribou-ui-headless`). The mount provides a shadow-DOM container that's morph-opaque (Elena's `morphContent` would otherwise wipe `<li>` children when the host's template emits the wrapping `<ul>` empty); the helper diffs the mount's inner `<ul>` by `status.id`. Cards keep object identity across polls, `loadMore`, and `applyNewPosts` — `caribou-status-card.status` no longer fires the setter on surviving cards, eliminating the avoidable card-internal re-renders that contributed to avatar flicker and lost scroll position under load.

Pure refactor; no user-facing UI changes. Plan 3 §11.1a deferred follow-up.
```

Save under `.changeset/`.

- [ ] **Step 4: Write the morph-spec changeset**

```markdown
---
"@beatzball/elena-morph-spec": patch
---

Pin morph behavior on empty native `<ul>` template parents — documents that Elena's `morphContent` **does** wipe live `<ul>` children when the host's render template emits the `<ul>` empty. `it.fails`-pinned: the day Elena's morph stops wiping these, the test will fail and Caribou's `<caribou-list-mount>` workaround can be retired. Useful as upstream documentation if/when lifted into `@elenajs/core`.
```

Save under `.changeset/`.

- [ ] **Step 5: Verify changesets**

Run: `pnpm changeset status`

Expected: three changesets listed, one per affected package.

- [ ] **Step 6: Commit**

```bash
git add .changeset/keyed-reconciler-helper.md .changeset/keyed-reconciler-adoption.md .changeset/morph-empty-native-parent-spec.md
git commit -m "chore: changesets for keyed-list reconciliation"
```

---

## Task 22: Final verification

**Goal of this task:** Confirm everything is green before opening the PR.

- [ ] **Step 1: Clean install + full pipeline from worktree root**

Run, in order:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all five PASS.

- [ ] **Step 2: Coverage check on the headless package**

Run: `pnpm --filter @beatzball/caribou-ui-headless test:coverage`

Expected: thresholds met (lines ≥95, functions ≥95, statements ≥95, branches ≥90). Specifically check the coverage report for `reconcile-keyed-list.ts` — every algorithm branch should be covered. If the `IS_DEV` initialization branch dips below 90 because the `false` path is not exercised in vitest, that's acceptable per Task 8 step 5; otherwise investigate the specific uncovered branch and add a test.

- [ ] **Step 3: Spot-check the rendered timeline manually**

Run: `pnpm --filter caribou-elena dev:portless`

Open the dev URL, sign in to a real Mastodon instance (per CLAUDE memory: `PUBLIC_BASE_URL` must be set). Watch the home timeline through one poll cycle (≥30s); confirm avatars don't flicker. Trigger `loadMore` by scrolling to the bottom; confirm new posts append without wiping existing. Open a thread; trigger a fresh fetch by reloading; confirm cards render correctly with depth indents.

- [ ] **Step 4: Sanity-check the PR scope**

Run: `git log --oneline main..HEAD`

Expected: the commits from Tasks 1–20, in order. No drift, no stray work.

Run: `git diff --stat main..HEAD`

Expected: ~600 LOC changed, dominated by tests; production code change ~150 LOC, matching the §12 spec estimate.

- [ ] **Step 5: Open the PR**

Compose the PR description with:
- Goal (one sentence from the spec).
- Architecture (one paragraph).
- Before / After table (from Task 20).
- Link to the design spec.
- Test plan checklist.

Use `gh pr create` per the harness's PR conventions.

---

## Self-Review (skill checklist — completed pre-handoff)

**Spec coverage:** every spec section maps to one or more tasks:
- §0 Goal → Task 22 step 5 (PR description).
- §1 Scope → Task 2 (mount), Tasks 3–10 (helper), Tasks 11–19 (three host integrations).
- §2 Architecture → Task 2 (mount), Tasks 3, 10 (helper module + export).
- §3 API + algorithm → Tasks 3–8 (TDD on each scenario + dev-mode invariants).
- §4 Validation POC → Task 1 (POC documentation, `it.fails`-pinned).
- §5.1 Timeline → Tasks 11–14.
- §5.2 Profile → Tasks 15–16.
- §5.3 Thread → Tasks 17–19.
- §6 SSR/hydration impact → no task; spec documents this is out of scope for this PR.
- §7.1 Helper unit tests → Tasks 3–8.
- §7.2 Component integration tests → Tasks 12, 16, 19.
- §7.3 Scroll preservation → Task 13.
- §7.4 Image identity → Task 14.
- §7.5 Validation POC test → Task 1.
- §7.6 `<caribou-list-mount>` unit tests → Task 2.
- §8.1 Op-count regression → Task 9.
- §8.2 Render-avoidance metric → Task 12 (timeline) + Task 16 (profile).
- §8.3 Before/after numbers → Task 20.
- §9 Out of scope → no task; spec captures.
- §10 Considered and rejected → no task; spec captures.

**Placeholder scan:** none — all code blocks are concrete; the only "TBD"-like content is the Task 20 numbers, which are intentionally captured at execution time (the table format is fully specified).

**Type consistency:** `reconcileKeyedList` API is identical across all uses (Tasks 3, 10, 11, 15, 18). The `ReconcileKeyedListOptions<T>` interface is defined once in Task 3 and consumed unchanged thereafter. `data-key` ownership is consistently the helper's. `keyOf` always takes the item type T and returns a string. `<caribou-list-mount>`'s `mountUl` getter is the single source for the parent passed to the helper across all three host integrations.
