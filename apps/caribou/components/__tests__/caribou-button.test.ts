import { afterEach, describe, expect, it, vi } from 'vitest'
import '../caribou-button.js'
import type { CaribouButton } from '../caribou-button.js'

async function mount(attrs: Record<string, string>, parent: Element = document.body): Promise<CaribouButton> {
  const el = document.createElement('caribou-button')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.textContent = 'Post'
  parent.appendChild(el)
  await el.updateComplete
  return el
}

function inner(el: CaribouButton): HTMLButtonElement {
  return el.shadowRoot!.querySelector('button')!
}

// The submit runs a task after the click, once every listener has had the
// chance to cancel it, as a native submit button's activation does.
function afterClick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

function stubInternals(form: HTMLFormElement | null) {
  const attach = vi.fn(() => ({ form }) as unknown as ElementInternals)
  Object.defineProperty(HTMLElement.prototype, 'attachInternals', { value: attach, configurable: true })
  return attach
}

function form(): HTMLFormElement {
  const f = document.createElement('form')
  document.body.appendChild(f)
  return f
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('caribou-button', () => {
  it('slots its text into a real button: one control, named by the text', async () => {
    const el = await mount({ variant: 'primary' })
    const b = inner(el)
    expect(b.type).toBe('button')
    expect(b.getAttribute('part')).toBe('button')
    expect(b.dataset.variant).toBe('primary')
    expect(b.querySelector('slot')).not.toBeNull()
    expect(el.textContent).toBe('Post')
    // The host is not a tab stop of its own; focus goes to the inner button.
    expect(el.hasAttribute('tabindex')).toBe(false)
    // happy-dom ignores delegatesFocus; the e2e spec checks the real Tab order.
    expect((el.constructor as typeof CaribouButton).shadowRootOptions.delegatesFocus).toBe(true)
  })

  it('defaults to the secondary variant and a plain button', async () => {
    const el = await mount({})
    expect(el.variant).toBe('secondary')
    expect(el.type).toBe('button')
  })

  it('type="submit" submits its form', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    const el = await mount({ type: 'submit' }, f)
    inner(el).click()
    await afterClick()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('a caller that cancels the click on the host stops the submit', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    const el = await mount({ type: 'submit' }, f)
    const order: string[] = []
    f.addEventListener('submit', () => order.push('submit'))
    el.addEventListener('click', (e) => { order.push('click'); e.preventDefault() })
    inner(el).click()
    await afterClick()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(order).toEqual(['click'])
  })

  it('a click already cancelled on the inner button does not submit', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    const el = await mount({ type: 'submit' }, f)
    inner(el).addEventListener('click', (e) => e.preventDefault())
    inner(el).click()
    await afterClick()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('caller click listeners run before the submit', async () => {
    const f = form()
    const order: string[] = []
    f.addEventListener('submit', (e) => { e.preventDefault(); order.push('submit') })
    const el = await mount({ type: 'submit' }, f)
    el.addEventListener('click', () => order.push('click'))
    inner(el).click()
    await afterClick()
    expect(order).toEqual(['click', 'submit'])
  })

  it('submits the form ElementInternals names', async () => {
    // happy-dom has no attachInternals; stand one in, naming a form other
    // than the nearest, to prove the internals win.
    const named = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    named.addEventListener('submit', onSubmit)
    const attach = stubInternals(named)
    try {
      const el = await mount({ type: 'submit' }, form())
      expect((el.constructor as typeof CaribouButton).formAssociated).toBe(true)
      expect(attach).toHaveBeenCalledOnce()
      expect(el.form).toBe(named)
      inner(el).click()
      await afterClick()
      expect(onSubmit).toHaveBeenCalledOnce()
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).attachInternals
    }
  })

  it('internals with no form (form="missing") submits nothing, not the nearest form', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    stubInternals(null)
    try {
      const el = await mount({ type: 'submit', form: 'missing' }, f)
      expect(el.form).toBeNull()
      inner(el).click()
      await afterClick()
      expect(onSubmit).not.toHaveBeenCalled()
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).attachInternals
    }
  })

  it('without ElementInternals (the server shim, happy-dom) uses the nearest form', async () => {
    const f = form()
    const el = await mount({ type: 'submit' }, f)
    expect(el.form).toBe(f)
  })

  it('a plain button does not submit', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    const el = await mount({}, f)
    inner(el).click()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('loading: busy, still focusable, and clicks are blocked', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    const el = await mount({ type: 'submit', loading: '' }, f)
    const onClick = vi.fn()
    el.addEventListener('click', onClick)
    const b = inner(el)
    expect(b.disabled).toBe(false)
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(el.shadowRoot!.querySelector('[part="spinner"]')).not.toBeNull()
    b.click()
    await afterClick()
    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    el.loading = false
    await el.updateComplete
    expect(b.hasAttribute('aria-busy')).toBe(false)
    expect(el.shadowRoot!.querySelector('[part="spinner"]')).toBeNull()
    b.click()
    await afterClick()
    expect(onClick).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('disabled: the inner button is disabled and the host reports no click', async () => {
    const f = form()
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    f.addEventListener('submit', onSubmit)
    const el = await mount({ type: 'submit', disabled: '' }, f)
    const onClick = vi.fn()
    el.addEventListener('click', onClick)
    expect(inner(el).disabled).toBe(true)
    el.click()
    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('a disabled fieldset disables it', async () => {
    const f = form()
    const fs = document.createElement('fieldset')
    f.appendChild(fs)
    const el = await mount({ type: 'submit' }, fs)
    el.formDisabledCallback(true)
    await el.updateComplete
    expect(inner(el).disabled).toBe(true)
    el.formDisabledCallback(false)
    await el.updateComplete
    expect(inner(el).disabled).toBe(false)
  })

  it('disabled by attribute, then re-enabled by property', async () => {
    const el = await mount({ disabled: '' })
    // The browser reports the host's own disabled attribute through this
    // callback, and calls it again only when that attribute changes.
    el.formDisabledCallback(true)
    await el.updateComplete
    expect(inner(el).disabled).toBe(true)
    el.disabled = false
    await el.updateComplete
    expect(el.hasAttribute('disabled')).toBe(false)
    el.formDisabledCallback(false)
    await el.updateComplete
    expect(inner(el).disabled).toBe(false)
  })

  it('a fieldset that disables it before the first render: SSR markup first, then disabled', async () => {
    // The server never hears from the fieldset, so the first render must
    // not either; the state lands on the button right after.
    const el = document.createElement('caribou-button')
    el.formDisabledCallback(true)
    // What the first render wrote, before updated() runs.
    const renders: (string | null)[] = []
    const hooks = el as unknown as { update(c: Map<string, unknown>): void }
    const update = hooks.update.bind(el)
    hooks.update = (c) => {
      update(c)
      if (renders.length === 0) renders.push(inner(el).getAttribute('disabled'))
    }
    document.body.appendChild(el)
    await el.updateComplete
    expect(renders).toEqual([null])
    expect(inner(el).disabled).toBe(true)
  })
})
