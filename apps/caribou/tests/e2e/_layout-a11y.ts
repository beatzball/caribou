import { test, expect, type Page } from './_fixtures.js'
import type { Locator } from '@playwright/test'
import { SSR_STATUS } from './_status-card-ssr.js'

// Mount the real components with plain fixture data. No live accounts,
// SDK sign-in or upstream requests are needed to measure layout.
async function fixturePage(page: Page, theme: string) {
  await page.goto('/local')
  await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
  await page.waitForFunction(() => !!customElements.get('caribou-status-card'))
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value
    document.body.replaceChildren()
    document.body.style.margin = '0'
  }, theme)
}

async function insideViewport(target: Locator, inset = 0) {
  await expect(target).toBeVisible()
  const box = (await target.boundingBox())!
  const viewport = await target.page().evaluate(() => ({
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? innerWidth,
    height: visualViewport?.height ?? innerHeight,
  }))
  expect(box.x).toBeGreaterThanOrEqual(viewport.left + inset - 0.5)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.left + viewport.width - inset + 0.5)
  expect(box.y).toBeGreaterThanOrEqual(viewport.top - 0.5)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.top + viewport.height + 0.5)
}

export function layoutAccessibilityTests() {
  for (const theme of ['dark', 'light']) {
    test(`${theme}: rule 1, both networks fit ordinary and CW post actions at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 })
      await fixturePage(page, theme)
      const minimum = await page.evaluate(() => matchMedia('(pointer: coarse)').matches ? 44 : 36)
      for (const network of ['mastodon', 'bluesky']) {
        for (const cw of [false, true]) {
          for (const count of [0, 1234567]) {
            await page.evaluate(async ({ source, network, cw, count }) => {
              const status = { ...source, spoilerText: cw ? 'Content warning' : '',
                repliesCount: count, reblogsCount: count, favouritesCount: count }
              if (network === 'bluesky') Object.assign(status, {
                id: 'at://did:plc:alice/app.bsky.feed.post/example',
                account: { ...status.account, id: 'did:plc:alice', acct: 'alice.example.com',
                  bluesky: { did: 'did:plc:alice', handleInvalid: false } },
                bluesky: { uri: 'at://did:plc:alice/app.bsky.feed.post/example', cid: 'bafyexample',
                  replyDisabled: false, embeddingDisabled: false, labels: [], viewerOf: null,
                  moderation: { contexts: Object.fromEntries(['contentList', 'contentView', 'contentMedia',
                    'avatar', 'banner', 'profileList', 'profileView'].map((key) => [key,
                    { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [] }])),
                  labelersCovered: [] } },
              })
              const card = document.createElement('caribou-status-card') as HTMLElement & {
                status: unknown; updateComplete: Promise<boolean>
              }
              // Enable the signed-in action layout without an authenticated client.
              Object.defineProperty(card, 'canAct', { get: () => true, set: () => {} })
              card.status = status
              document.body.replaceChildren(card)
              while (!(await card.updateComplete)) { /* settle */ }
            }, { source: SSR_STATUS.reblog, network, cw, count })
            const actions = page.locator('.actions')
            await expect(actions.locator('caribou-icon-button')).toHaveCount(network === 'bluesky' ? 5 : 4)
            const buttons = actions.locator('caribou-icon-button button, caribou-menu .trigger')
            await expect(buttons).toHaveCount(network === 'bluesky' ? 6 : 5)
            for (const button of await buttons.all()) {
              await insideViewport(button)
              const box = (await button.boundingBox())!
              expect(box.width).toBeGreaterThanOrEqual(minimum)
              expect(box.height).toBeGreaterThanOrEqual(minimum)
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
          }
        }
      }
    })

    test(`${theme}: rule 2, attached-image label menu stays inside phone viewports`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 })
      await fixturePage(page, theme)
      await page.evaluate(async () => {
        const compose = document.createElement('caribou-compose-dialog') as unknown as HTMLElement & {
          ready: boolean; client: unknown; draft: { bluesky: unknown }; updateComplete: Promise<boolean>
        }
        // The same attached-image draft the upload path renders. Only the
        // client's capabilities are used; no write can be sent from here.
        compose.client = { capabilities: { network: 'bluesky', maxPostChars: 300, maxBytes: 3000 } }
        compose.draft = { ...compose.draft, bluesky: { images: [{ id: 'image-1', name: 'image.png',
          alt: 'A sample image', mime: 'image/png', size: 100, aspectRatio: null,
          blob: { ref: { $link: 'bafyexample' }, mimeType: 'image/png', size: 100 } }], labels: [] } }
        compose.ready = true
        document.body.append(compose)
        while (!(await compose.updateComplete)) { /* settle */ }
        compose.shadowRoot!.querySelector('dialog')!.showModal()
      })
      const menu = page.locator('caribou-compose-dialog caribou-menu.labels')
      const trigger = menu.locator('.trigger')
      const panel = menu.locator('.panel')
      for (const width of [320, 393, 412]) {
        await page.setViewportSize({ width, height: 640 })
        await trigger.click()
        await insideViewport(panel, 8)
        for (const item of await menu.locator('button[data-label]').all()) {
          await item.focus()
          await expect(item).toBeFocused()
          await insideViewport(item, 8)
          expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        }
        // Resize while open and make a caller-supplied label very long.
        await menu.locator('button[data-label]').first().evaluate((el) => {
          el.textContent = 'A very long media label '.repeat(10)
        })
        await page.setViewportSize({ width: 320, height: 560 })
        await expect(async () => { await insideViewport(panel, 8) }).toPass()
        await insideViewport(menu.locator('button[data-label]').first(), 8)
        await menu.evaluate((el) => (el as HTMLElement & { hide(): void }).hide())
        await expect(panel).toBeHidden()
      }
      // The opposite edge, with the same actual label menu and stylesheet.
      await menu.evaluate((el) => { el.style.marginInlineStart = 'auto' })
      await trigger.click()
      await insideViewport(panel, 8)
    })

    test(`${theme}: rule 3, actual blog article anchors have 44px targets`, async ({ page }) => {
      for (const width of [1024, 320]) {
        await page.setViewportSize({ width, height: 700 })
        await page.goto('/blog')
        await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
        await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
        const links = page.locator('page-blog li').getByRole('link')
        await expect(links).toHaveCount(3)
        for (const link of await links.all()) {
          await insideViewport(link)
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        }
      }
      await page.getByRole('link', { name: 'Hello World', exact: true }).click()
      await expect(page).toHaveURL(/\/blog\/hello-world$/)
    })

    test(`${theme}: rule 4, ALT targets fit every media kind and retain separate activation`, async ({ page }) => {
      await fixturePage(page, theme)
      const minimum = await page.evaluate(() => matchMedia('(pointer: coarse)').matches ? 44 : 24)
      for (const width of [1024, 320]) {
        await page.setViewportSize({ width, height: 700 })
        for (const type of ['image', 'gifv', 'video', 'audio', 'unknown']) {
          await page.evaluate(async (type) => {
            const media = document.createElement('caribou-status-media') as HTMLElement & {
              media: unknown[]; updateComplete: Promise<boolean>
            }
            media.media = [{ id: 'media-1', type, url: '', previewUrl: '',
              description: 'A sample attachment', meta: { original: { width: 400, height: 200, aspect: 2 } } }]
            document.body.replaceChildren(media)
            while (!(await media.updateComplete)) { /* settle */ }
          }, type)
          const media = page.locator('caribou-status-media')
          const alt = media.getByRole('button', { name: 'ALT, show the description', exact: true })
          await insideViewport(alt)
          const box = (await alt.boundingBox())!
          expect(box.width).toBeGreaterThanOrEqual(minimum)
          expect(box.height).toBeGreaterThanOrEqual(minimum)
          await alt.click()
          await expect(media.locator('.alt-text')).toBeVisible()
          await expect(media.locator('.alt-text')).toHaveText('A sample attachment')
          await expect(media.locator('dialog')).not.toBeVisible()
          await page.keyboard.press('Escape')
          if (type === 'image') {
            await media.locator('.thumb').click({ position: { x: 100, y: 50 } })
            await expect(media.locator('dialog')).toBeVisible()
            await expect(media.locator('dialog p')).toHaveText('A sample attachment')
            await page.keyboard.press('Escape')
          }
        }
      }
    })
  }
}
