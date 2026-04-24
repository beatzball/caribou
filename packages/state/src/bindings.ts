import { effect } from '@preact/signals-core'

export function bindSignals<T extends { update?: () => void; requestUpdate?: () => void }>(
  instance: T,
  read: () => void,
): () => void {
  return effect(() => {
    read()
    const fn = instance.update ?? instance.requestUpdate
    if (typeof fn === 'function') fn.call(instance)
  })
}
