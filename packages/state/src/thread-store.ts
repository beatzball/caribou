import { batch, signal, type ReadonlySignal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { CaribouClient, CaribouError } from '@beatzball/caribou-mastodon-client'
import { cacheStatus, mergeStatus } from './caches.js'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: CaribouError }

export interface ThreadContext {
  ancestors: mastodon.v1.Status[]
  descendants: mastodon.v1.Status[]
}

export interface ThreadStore {
  focused: ReadonlySignal<AsyncState<mastodon.v1.Status>>
  context: ReadonlySignal<AsyncState<ThreadContext>>
  load(): Promise<void>
  /**
   * Takes a fresh copy of the thread fetched by another route (the page's
   * server data). Posts already shown get their fresh copy in place; new
   * replies go after the last one, so nothing above the reader moves.
   */
  offer(fresh: ThreadContext & { focused: mastodon.v1.Status }): void

  /** Test-only — do not use in production code. Injects descendants directly
   *  into the context signal so integration tests can drive descendant-arrival
   *  scenarios without a real Mastodon client. Mirrors _testOnlyPrepend on
   *  TimelineStore. */
  _testOnlySetDescendants(xs: mastodon.v1.Status[]): void
}

export interface CreateThreadStoreOpts {
  initial?: {
    focused: mastodon.v1.Status
    ancestors: mastodon.v1.Status[]
    descendants: mastodon.v1.Status[]
  }
}

export function createThreadStore(
  client: CaribouClient,
  statusId: string,
  opts: CreateThreadStoreOpts,
): ThreadStore {
  const focused = signal<AsyncState<mastodon.v1.Status>>({ status: 'idle' })
  const context = signal<AsyncState<ThreadContext>>({ status: 'idle' })

  if (opts.initial) {
    cacheStatus(opts.initial.focused)
    for (const s of opts.initial.ancestors) cacheStatus(s)
    for (const s of opts.initial.descendants) cacheStatus(s)
    focused.value = { status: 'ready', data: opts.initial.focused }
    context.value = {
      status: 'ready',
      data: {
        ancestors: opts.initial.ancestors,
        descendants: opts.initial.descendants,
      },
    }
  }

  async function load() {
    if (focused.value.status === 'ready' && context.value.status === 'ready') return

    if (focused.value.status !== 'ready') focused.value = { status: 'loading' }
    if (context.value.status !== 'ready') context.value = { status: 'loading' }

    const [focusedResult, contextResult] = await Promise.allSettled([
      client.fetchStatus(statusId),
      client.fetchThread(statusId),
    ])

    if (focusedResult.status === 'fulfilled') {
      cacheStatus(focusedResult.value)
      focused.value = { status: 'ready', data: focusedResult.value }
    } else {
      focused.value = { status: 'error', error: focusedResult.reason as CaribouError }
    }

    if (contextResult.status === 'fulfilled') {
      for (const s of contextResult.value.ancestors) cacheStatus(s)
      for (const s of contextResult.value.descendants) cacheStatus(s)
      context.value = { status: 'ready', data: contextResult.value }
    } else {
      context.value = { status: 'error', error: contextResult.reason as CaribouError }
    }
  }

  function offer(fresh: ThreadContext & { focused: mastodon.v1.Status }) {
    batch(() => offerNow(fresh))
  }

  // A reply that the fresh thread no longer has stays, and a new ancestor is
  // not added: both would move the posts above the reader.
  function offerNow(fresh: ThreadContext & { focused: mastodon.v1.Status }) {
    const byId = new Map<string, mastodon.v1.Status>()
    for (const s of [fresh.focused, ...fresh.ancestors, ...fresh.descendants]) byId.set(s.id, mergeStatus(s))
    const latest = (s: mastodon.v1.Status) => byId.get(s.id) ?? s
    focused.value = { status: 'ready', data: byId.get(fresh.focused.id)! }
    if (context.value.status !== 'ready') {
      context.value = { status: 'ready', data: {
        ancestors: fresh.ancestors.map(latest), descendants: fresh.descendants.map(latest),
      } }
      return
    }
    const { ancestors, descendants } = context.value.data
    const shown = new Set(descendants.map((s) => s.id))
    context.value = { status: 'ready', data: {
      ancestors: ancestors.map(latest),
      descendants: [
        ...descendants.map(latest),
        ...fresh.descendants.filter((s) => !shown.has(s.id)).map(latest),
      ],
    } }
  }

  // test-only — do not use in production code
  function _testOnlySetDescendants(xs: mastodon.v1.Status[]): void {
    for (const s of xs) cacheStatus(s)
    const currentAncestors =
      context.value.status === 'ready' ? context.value.data.ancestors : []
    context.value = { status: 'ready', data: { ancestors: currentAncestors, descendants: xs } }
  }

  return { focused, context, load, offer, _testOnlySetDescendants }
}
