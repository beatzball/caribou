import { test, expect } from '@playwright/test'
import {
  activeBoost, compose, expectBoundary, expectText, fixture, mount, post, ratio,
  type Network, type Theme,
} from './_contrast.js'

export function contrastChecks() {
  for (const theme of ['dark', 'light'] as Theme[]) {
    for (const network of ['mastodon', 'bluesky'] as Network[]) {
      test.describe(`${theme} ${network} contrast (#288)`, () => {
        test.beforeEach(async ({ page }) => fixture(page, theme))

        test('rule 1: muted metadata, hover hints, compose notes and empty notices reach 4.5:1', async ({ page }) => {
          const status = post(network)
          const card = await mount(page, 'caribou-status-card', { status })
          await expectText(card.locator('.acct'))
          await expectText(card.locator('time'))
          const quote = await mount(page, 'caribou-status-quote', { quote: { state: 'accepted', quotedStatus: status } })
          await quote.locator('.quote').hover()
          await expectText(quote.locator('.acct'))
          const settings = await mount(page, 'caribou-settings-appearance')
          await settings.locator('label').last().hover()
          await expectText(settings.locator('.hint'))
          const empty = await mount(page, 'caribou-timeline', { initial: { statuses: [], nextCursor: null } })
          await expectText(empty.locator('.notice'))
          const dialog = await compose(page, network, network === 'mastodon')
          await expectText(dialog.locator('.count'))
          if (network === 'mastodon') await expectText(dialog.locator('[data-poll] .note').first())
          // Field and stronger panel fills also host muted text elsewhere.
          for (const surface of ['--bg-1', '--bg-2']) {
            await card.evaluate((el, surface) => { (el as HTMLElement).style.background = `var(${surface})` }, surface)
            await expectText(card.locator('.acct'))
          }
        })

        test('rule 1: active boost counts reach 4.5:1 normally and hovered', async ({ page }) => {
          const card = await mount(page, 'caribou-status-card', { status: post(network) })
          const boost = await activeBoost(card)
          await expectText(boost.locator('.count'))
          await boost.hover()
          await expectText(boost.locator('.count'))
          for (const surface of ['--bg-1', '--bg-2']) {
            await card.evaluate((el, surface) => { (el as HTMLElement).style.background = `var(${surface})` }, surface)
            await expectText(boost.locator('.count'))
          }
        })

        test('rule 2: real thread ancestors keep readable metadata, links and boost counts', async ({ page }) => {
          const thread = await mount(page, 'caribou-thread', {
            statusId: post(network, 'focus').id,
            initial: { focused: post(network, 'focus'), ancestors: [post(network, 'ancestor')], descendants: [] },
          })
          const ancestor = thread.locator('caribou-status-card[variant="ancestor"]')
          await expect(ancestor).toHaveCount(1)
          await activeBoost(ancestor)
          await expectText(ancestor.locator('.acct'))
          await expectText(ancestor.locator('.status-content a'))
          await expectText(ancestor.locator('caribou-icon-button.boost .count'))
        })

        for (const kind of ['placeholders', 'boundaries'] as const) {
          test(`rule ${kind === 'placeholders' ? 3 : 4}: readable unfocused ${kind} across sign-in, Search, compose and list fields`, async ({ page }) => {
            const check = kind === 'placeholders'
              ? (target: ReturnType<typeof page.locator>) => expectText(target, '::placeholder')
              : expectBoundary
            const signin = await mount(page, network === 'mastodon' ? 'caribou-instance-picker' : 'caribou-bluesky-signin')
            await check(signin.locator('input'))
            if (kind === 'boundaries') {
              for (const surface of ['--bg-1', '--bg-2']) {
                await signin.evaluate((el, surface) => { (el as HTMLElement).style.background = `var(${surface})` }, surface)
                await check(signin.locator('input'))
              }
            }
            const search = await mount(page, 'caribou-search')
            await check(search.locator('input'))
            const rail = await mount(page, 'caribou-right-rail')
            await check(rail.locator('input'))
            const dialog = await compose(page, network)
            await check(dialog.locator('textarea'))
            await check(dialog.locator('.media input'))
            if (network === 'mastodon') {
              await check(dialog.locator('#compose-cw'))
              await dialog.evaluate(async (el) => {
                const compose = el as HTMLElement & { draft: Record<string, unknown>; updateComplete: Promise<boolean> }
                compose.draft = { ...compose.draft, media: [], poll: { options: ['', ''], expiresIn: 86400, multiple: false, hideTotals: false } }
                while (!(await compose.updateComplete)) { /* settle */ }
              })
              await check(dialog.locator('[data-option="0"]'))
              await check(dialog.locator('[data-option="1"]'))
            }
            if (kind === 'boundaries') {
              const list = await mount(page, 'caribou-list-dialog', { bluesky: network === 'bluesky' })
              await check(list.locator('#title'))
              if (network === 'bluesky') {
                const words = await mount(page, 'caribou-muted-words', { words: [] })
                await check(words.locator('input[name="value"]'))
              }
            }
          })
        }

        test('rule 5: ALT keyboard focus contrasts with opaque backing over gray, white, black and mixed images', async ({ page }, testInfo) => {
          for (const [name, image] of Object.entries({
            gray: '<rect width="400" height="200" fill="#888"/>',
            white: '<rect width="400" height="200" fill="white"/>',
            black: '<rect width="400" height="200" fill="black"/>',
            mixed: '<rect width="400" height="200" fill="white"/><path d="M0 0L400 200H0Z" fill="black"/>',
          })) {
            const url = new URL(`/contrast-${name}.svg`, page.url()).href
            await page.route(url, (route) => route.fulfill({
              contentType: 'image/svg+xml',
              body: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">${image}</svg>`,
            }))
            const card = await mount(page, 'caribou-status-card', { status: { ...post(network, name), mediaAttachments: [{
              id: name, type: 'image', url, previewUrl: url, description: `${name} fixture`,
              meta: { small: { width: 400, height: 200, aspect: 2 } },
            }] } }, `media-${name}`)
            const media = card.locator('caribou-status-media')
            await expect.poll(() => media.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
            const alt = media.locator('button.alt')
            await alt.focus()
            await page.keyboard.press('Tab')
            await page.keyboard.press('Shift+Tab')
            await expect(alt).toBeFocused()
            const focus = await alt.evaluate((el) => {
              const css = getComputedStyle(el)
              return {
                visible: el.matches(':focus-visible'), outline: css.outlineColor.match(/[\d.]+/g)!.map(Number),
                width: parseFloat(css.outlineWidth), offset: parseFloat(css.outlineOffset),
                backing: css.backgroundColor.match(/[\d.]+/g)!.map(Number), shadow: css.boxShadow,
                stroke: css.boxShadow.match(/rgba?\([^)]+\)/)?.[0].match(/[\d.]+/g)?.map(Number) ?? [],
              }
            })
            expect(focus.visible).toBe(true)
            expect(focus.width).toBeGreaterThanOrEqual(2)
            expect(focus.offset).toBeGreaterThanOrEqual(0)
            expect(focus.backing[3] ?? 1, 'opaque backing hides arbitrary image pixels').toBe(1)
            expect(ratio(focus.outline, focus.backing)).toBeGreaterThanOrEqual(3)
            expect(focus.shadow).not.toContain('inset')
            expect(focus.shadow).toContain('6px')
            expect(focus.stroke).toHaveLength(3)
            expect(ratio(focus.outline, focus.stroke)).toBeGreaterThanOrEqual(3)
            await testInfo.attach(`${name}-focus`, { body: await media.screenshot(), contentType: 'image/png' })
            const thumb = media.locator('a.thumb')
            await thumb.focus()
            const ring = await thumb.evaluate((el) => {
              const css = getComputedStyle(el)
              return { visible: el.matches(':focus-visible'), offset: parseFloat(css.outlineOffset), shadow: css.boxShadow }
            })
            expect(ring.visible).toBe(true)
            expect(ring.offset).toBe(-4)
            expect(ring.shadow).toContain('inset')
          }
        })
      })
    }
  }
}
