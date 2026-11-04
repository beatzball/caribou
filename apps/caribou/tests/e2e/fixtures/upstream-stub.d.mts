// Types for what specs import from `upstream-stub.mjs`.
interface StubPoll {
  id: string
  options: { title: string; votes_count: number }[]
  [key: string]: unknown
}

export function pollPosts(): ({ id: string; poll: StubPoll } & Record<string, unknown>)[]
