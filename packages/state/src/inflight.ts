// The reader's status actions that are still waiting for the server, as
// `<action>:<status id>`. Shared by `mutations.ts`, which owns it, and
// `caches.ts`, whose merge must not overwrite a post that is mid-action.
export const inflight = new Set<string>()

/** Whether any action on status `id` is waiting for the server. */
export function isMutating(id: string): boolean {
  for (const key of inflight) if (key.slice(key.indexOf(':') + 1) === id) return true
  return false
}
