import { expect, test } from '@playwright/test'
import { SSR_SUBMIT_BUTTON } from './_ui-controls-ssr.js'

// No route server-renders a shared control yet (compose renders nothing on
// the server), so this replays real server markup into a page that has
// loaded the app, and lets Lit hydrate it. It checks the native button the
// server sent is kept, and that a disabled fieldset reaches it: the server
// never hears from the fieldset, so the client must apply it after
// hydration.
for (const fieldset of [false, true]) {
  test(`a server-rendered caribou-button hydrates${fieldset ? ' inside a disabled fieldset' : ''}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/about')
    await page.locator('litro-outlet[data-litro-settled]').waitFor({ state: 'attached' })
    await page.waitForFunction(() => customElements.get('caribou-button') !== undefined)

    const state = await page.evaluate(async ({ markup, fieldset }) => {
      const box = document.createElement('div')
      const inner = fieldset ? `<fieldset disabled>${markup}</fieldset>` : markup
      // setHTMLUnsafe parses declarative shadow roots, as page load does.
      box.setHTMLUnsafe(`<form>${inner}</form>`)
      const host = box.querySelector('caribou-button')! as HTMLElement & { updateComplete: Promise<boolean> }
      const sent = host.shadowRoot!.querySelector('button')!
      document.body.append(box)
      await host.updateComplete
      await new Promise((r) => setTimeout(r, 0))
      const buttons = host.shadowRoot!.querySelectorAll('button')
      return { kept: buttons.length === 1 && buttons[0] === sent, disabled: sent.disabled }
    }, { markup: SSR_SUBMIT_BUTTON, fieldset })

    expect(state).toEqual({ kept: true, disabled: fieldset })
    expect(errors).toEqual([])
  })
}
