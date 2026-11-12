import { expect, type Page } from './_fixtures.js'
import type { Locator } from '@playwright/test'

/** Check the modal alert, including the browser's native AX tree on Chromium. */
export async function expectComposeAlert(page: Page, dialog: Locator, message: string) {
  await expect(dialog.getByRole('alert')).toContainText(message)
  expect(await dialog.ariaSnapshot()).toContain(message)
  if (page.context().browser()?.browserType().name() !== 'chromium') return
  const cdp = await page.context().newCDPSession(page)
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const byId = new Map(nodes.map((node) => [node.nodeId, node]))
    const alert = nodes.find((node) => !node.ignored && node.role?.value === 'alert')
    expect(alert, 'the modal error is exposed as an alert').toBeTruthy()
    const descendants = [alert!]
    for (let i = 0; i < descendants.length; i++) {
      for (const id of descendants[i]!.childIds ?? []) {
        const child = byId.get(id)
        if (child) descendants.push(child)
      }
    }
    expect(descendants.some((node) => !node.ignored && String(node.name?.value ?? '').includes(message))).toBe(true)
    let ancestor = alert
    while (ancestor && ancestor.role?.value !== 'dialog') ancestor = byId.get(ancestor.parentId ?? '')
    expect(ancestor?.name?.value, 'the alert belongs to the active modal').toBe(await dialog.locator('h2').textContent())
  } finally {
    await cdp.detach()
  }
}
