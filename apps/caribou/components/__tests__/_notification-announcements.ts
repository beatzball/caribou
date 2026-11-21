import { vi } from 'vitest'
import type { LitElement, PropertyValues } from 'lit'

// Record the DOM after every update, including initial mount and the store
// completion that can render before an awaiting event handler resumes.
export function recordNotificationAnnouncements(el: LitElement) {
  const frames: { region: Element | null; message: string | null; notice: string | null }[] = []
  const target = el as unknown as { updated(changed: PropertyValues): void }
  const updated = target.updated.bind(el)
  vi.spyOn(target, 'updated').mockImplementation((changed) => {
    updated(changed)
    const region = el.shadowRoot!.querySelector('[role="status"]')
    frames.push({
      region,
      message: region?.textContent ?? null,
      notice: el.shadowRoot!.querySelector('.notice')?.textContent ?? null,
    })
  })
  return frames
}
