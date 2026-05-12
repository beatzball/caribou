import type { mastodon } from 'masto'
import { renderShadowComponentToString } from './render-shadow.js'

export interface PopulatedListItem {
  status: mastodon.v1.Status
  variant: 'timeline' | 'focused' | 'ancestor' | 'descendant'
  depth?: number | null
}

export interface RenderPopulatedListOptions {
  items: readonly PopulatedListItem[]
  serverNowMs: number
}

/**
 * Compose the declarative-shadow-DOM HTML for a <caribou-list-mount>
 * whose shadow root contains a populated <ul><li>...</li></ul>.
 *
 * Each <li> wraps a <caribou-status-card> rendered via
 * renderShadowComponentToString. The data-rendered-at attribute is
 * set on every card so the client's first render after hydration uses
 * the SSR 'now' (server-now threaded through opts.serverNowMs).
 */
export async function renderPopulatedListMount(
  opts: RenderPopulatedListOptions,
): Promise<string> {
  const { items, serverNowMs } = opts

  const liChunks: string[] = []
  for (const item of items) {
    const cardHtml = await renderShadowComponentToString('caribou-status-card', {
      attrs: {
        variant: item.variant,
        'data-rendered-at': String(serverNowMs),
      },
      props: { status: item.status },
    })
    liChunks.push(buildLi(item, cardHtml))
  }

  return (
    `<caribou-list-mount>` +
    `<template shadowrootmode="open">` +
    `<style>:host { display: block }</style>` +
    `<ul style="list-style:none;margin:0;padding:0;">` +
    liChunks.join('') +
    `</ul>` +
    `</template>` +
    `</caribou-list-mount>`
  )
}

function buildLi(item: PopulatedListItem, cardHtml: string): string {
  const key = item.status.id
  // Empty-case bootstrap: only the data-key is required. Depth / style
  // are added in Task 7.
  return `<li data-key="${escapeAttr(key)}">${cardHtml}</li>`
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
