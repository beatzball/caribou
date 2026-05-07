import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { CaribouClient, CaribouError } from '@beatzball/caribou-mastodon-client'
import { cacheStatus } from './caches.js'

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

  return { focused, context, load }
}
