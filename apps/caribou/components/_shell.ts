import { activeClient, activeUser, loadReaderView } from '@beatzball/caribou-state'
import type { mastodon } from 'masto'

// The page sets the instance its data came from on the shell, and a list or
// card sits inside other elements' shadow roots, so walk up through each
// shadow host until a shell is found.
export function findShell(from: Element): Element | null {
  let el: Element | null = from
  while (el) {
    const shell = el.closest('caribou-app-shell')
    if (shell) return shell
    const root = el.getRootNode()
    el = root instanceof ShadowRoot ? root.host : null
  }
  return null
}

/**
 * Asks the reader's server for its own copy of posts the page server
 * rendered without a token, so the reader's filters apply to them. Only
 * when the posts came from the reader's server (`instance`, a bare host):
 * status ids mean nothing on another one. Client only; no session, no-op.
 */
export function loadReaderViewFrom(instance: string, statuses: readonly mastodon.v1.Status[]): void {
  const client = activeClient.peek()
  const server = activeUser.peek()?.server
  if (!client || !server || !instance || instance.toLowerCase() !== server.toLowerCase()) return
  void loadReaderView(statuses, client)
}
