// The reader's writes that are still waiting for the server, as
// `<action>:<status id>`. Shared by `mutations.ts` and `polls.ts`, which
// own it, and `caches.ts`, whose merge must not undo a vote that is out.
export const inflight = new Set<string>()
