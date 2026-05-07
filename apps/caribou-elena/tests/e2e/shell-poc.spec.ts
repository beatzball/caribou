import { test, expect } from '@playwright/test'

// Real-browser verification of the §6.5 / §6.6 adoption-suppression
// contract: when a DSD-prerendered <caribou-app-shell> mounts and Elena's
// upgrade path runs, the shadow root's `adoptedStyleSheets` must remain
// length-0 (the inline <style id="caribou-dsd-style"> sentinel IS the
// authoritative stylesheet).
//
// DEFERRED to Phase B. Phase A delivers two pieces that together discharge
// the gate without a real-browser test:
//
//   1. `pages/components/elena-shadow.ts` — Caribou's CaribouElena() wrapper
//      overrides upstream `_attachShadow` to skip `adoptedStyleSheets`
//      assignment when the sentinel is first child. Verified in jsdom
//      via spy-on-upstream-prototype:
//      `pages/components/__tests__/elena-shadow.test.ts`.
//   2. `server/lib/render-shadow.ts` — emits the `<style id="caribou-dsd-
//      style">` sentinel as the first child of every DSD template, so
//      mounted instances always satisfy CaribouElena's suppression branch.
//      Verified in jsdom via render output assertions:
//      `server/lib/__tests__/render-shadow.test.ts`.
//
// Why defer the Playwright leg:
//   - In Phase A there is no SSR'd shell route to navigate to. Plan-3
//     Phase B+C wire pageData → DSD → bundled component into the
//     `[...].ts` catch-all. Until then, an E2E test would have to mock
//     server output OR build a one-off test fixture page — both
//     synthetic enough to provide weak signal.
//   - Real browsers' `adoptedStyleSheets` is observable; jsdom's is not.
//     The browser check matters when we can hit a *production-shaped*
//     route. That arrives with Phase B's `/local` SSR pipeline.
//
// Phase B ticket: re-enable this test once `pages/local.ts` is shipping
// SSR HTML through `renderShadowComponentToString`. Drop the `fixme()`
// guard and assert against `page.goto('/local')` directly.
test.fixme('DSD adoption suppression on Elena upgrade (real browser)', async ({ page }) => {
  await page.goto('/local')
  await page.waitForFunction(() => !!customElements.get('caribou-app-shell'))
  const adoptedLen = await page.evaluate(() => {
    const el = document.querySelector('caribou-app-shell')
    return el?.shadowRoot?.adoptedStyleSheets.length ?? -1
  })
  expect(adoptedLen).toBe(0)
  const sentinelOk = await page.evaluate(() => {
    const el = document.querySelector('caribou-app-shell')
    const first = el?.shadowRoot?.firstElementChild as HTMLStyleElement | null
    return !!first && first.tagName === 'STYLE' && first.id === 'caribou-dsd-style'
  })
  expect(sentinelOk).toBe(true)
})
