import type { mastodon } from 'masto'
import { activeClient, createList, updateList } from '@beatzball/caribou-state'
import { listDialog } from './caribou-list-dialog.js'

// The New list and Edit list dialogs and what follows them, shared by
// /lists, a list's header and the profile's list picker. Its own module, so
// a profile page does not load the /lists page's element.

/** Whether the server has `exclusive` (4.2+): it sends it on every list. */
export const supportsExclusive = (lists: readonly mastodon.v1.List[] | undefined) =>
  !!lists?.some((l) => typeof l.exclusive === 'boolean')

/** Asks for a new list's fields and makes it. Resolves to the list, or null. */
export async function newListFlow(lists: readonly mastodon.v1.List[] | undefined): Promise<mastodon.v1.List | null> {
  const client = activeClient.peek()
  const input = await listDialog({ title: 'New list', submitLabel: 'Create', exclusive: supportsExclusive(lists) })
  if (!input || !client || activeClient.peek()?.userKey !== client.userKey) return null
  return createList(input, { clientSource: () => client })
}

/** Asks for a list's new fields and saves them. */
export async function editListFlow(list: mastodon.v1.List, lists: readonly mastodon.v1.List[] | undefined): Promise<void> {
  const client = activeClient.peek()
  const input = await listDialog({
    title: 'Edit list', submitLabel: 'Save', exclusive: supportsExclusive(lists),
    initial: { title: list.title, repliesPolicy: list.repliesPolicy, exclusive: list.exclusive },
  })
  if (!input || !client || activeClient.peek()?.userKey !== client.userKey) return
  await updateList(list.id, input, { clientSource: () => client })
}
