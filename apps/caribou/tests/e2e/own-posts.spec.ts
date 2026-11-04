import { expect, test, type Page } from './_fixtures.js'
import { card, collectErrors, signIn } from './_moderation.js'
import { BOB, fakeServer, gotoSettled, openThread, own, status } from './_own-posts.js'

// Edit and delete the reader's own posts, with edit history (#57).

const menu = (page: Page, id: string) => card(page, id).getByRole('button', { name: /^More actions/ })
const compose = (page: Page) => page.locator('caribou-compose-dialog dialog')
const toaster = (page: Page) => page.locator('caribou-toaster')

test('the menu on the reader\'s own post has Edit and Delete; another account\'s post has Mute and Block', async ({ page }) => {
  await signIn(page)
  await fakeServer(page, [own('1', 'mine'), status('2', BOB)])
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await expect(card(page, '1').getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(card(page, '1').getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await expect(card(page, '1').getByRole('button', { name: 'Delete & redraft' })).toBeVisible()
  await expect(card(page, '1').getByRole('button', { name: /Mute|Block/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await menu(page, '2').click()
  await expect(card(page, '2').getByRole('button', { name: 'Mute @bob' })).toBeVisible()
  await expect(card(page, '2').getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
})

test('edit in a thread: the thread and the timeline both show the change, with an edited mark', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  const s = await fakeServer(page, [own('1', 'teh typo')])
  await gotoSettled(page, '/home')
  await expect(card(page, '1')).toContainText('teh typo')
  await openThread(page, s, '1')
  const focused = page.locator('page-handle-statusid:not([hidden]) caribou-status-card[data-id="1"]')
  await expect(focused).toContainText('teh typo')

  await focused.getByRole('button', { name: /^More actions/ }).click()
  await focused.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = compose(page)
  await expect(dialog.getByRole('heading', { name: 'Edit post' })).toBeVisible()
  const text = dialog.getByRole('textbox', { name: 'Post text' })
  await expect(text).toHaveValue('teh typo')
  await expect(dialog.getByRole('combobox', { name: 'Visibility' })).toBeDisabled()
  await text.fill('the typo, fixed')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(toaster(page)).toContainText('Post updated')
  await expect(focused).toContainText('the typo, fixed')
  await expect(focused.getByRole('button', { name: /Show edit history/ })).toBeVisible()
  expect(s.writes).toEqual(['PUT 1'])

  await page.goBack()
  await expect(page.locator('litro-outlet > page-home:not([hidden])')).toHaveCount(1)
  await expect(card(page, '1')).toContainText('the typo, fixed')
  await expect(card(page, '1')).not.toContainText('teh typo')
  expect(errors).toEqual([])
})

test('the edited mark opens the history, newest first', async ({ page }) => {
  await signIn(page)
  const s = await fakeServer(page, [own('1', 'third', { edited_at: '2026-11-01T10:00:00.000Z' })])
  s.history.set('1', [
    own('1', 'first'), own('1', 'second'), own('1', 'third', { spoiler_text: 'a warning' }),
  ].map((p, i) => ({ ...p, created_at: `2026-11-01T0${i}:00:00.000Z` })))
  await gotoSettled(page, '/home')
  const mark = card(page, '1').getByRole('button', { name: /Show edit history/ })
  await mark.click()
  const dialog = page.getByRole('dialog', { name: 'Edit history' })
  await expect(dialog).toBeVisible()
  const versions = dialog.getByRole('listitem')
  await expect(versions).toHaveCount(3)
  await expect(versions.nth(0)).toContainText('Current version')
  await expect(versions.nth(0)).toContainText('a warning')
  await expect(versions.nth(0)).toContainText('third')
  await expect(versions.nth(2)).toContainText('Original')
  await expect(versions.nth(2)).toContainText('first')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(mark).toBeFocused()
})

test('a failed edit keeps the dialog and the text, and the post as it was', async ({ page }) => {
  await signIn(page)
  const s = await fakeServer(page, [own('1', 'teh typo')])
  s.fail.edit = true
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = compose(page)
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('changed')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(toaster(page)).toContainText('Could not save the edit')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('changed')
  await expect(card(page, '1')).toContainText('teh typo')
})

test('delete asks first; Cancel keeps the post; Delete removes it', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  const s = await fakeServer(page, [own('1', 'mine'), status('2', BOB)])
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this post?' })
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card(page, '1')).toContainText('mine')
  expect(s.writes).toEqual([])

  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Delete', exact: true }).click()
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(card(page, '1')).toHaveCount(0)
  await expect(card(page, '2')).toContainText('post 2')
  await expect(toaster(page)).toContainText('Post deleted')
  expect(s.writes).toEqual(['DELETE 1'])
  expect(errors).toEqual([])
})

test('a failed delete brings the post back and says so', async ({ page }) => {
  await signIn(page)
  const s = await fakeServer(page, [own('1', 'mine')])
  s.fail.delete = true
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(toaster(page)).toContainText('Could not delete this post')
  await expect(card(page, '1')).toContainText('mine')
})

test('delete & redraft opens compose filled from the deleted post', async ({ page }) => {
  await signIn(page)
  const s = await fakeServer(page, [own('1', 'say it again', { visibility: 'unlisted', spoiler_text: 'cw' })])
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Delete & redraft' }).click()
  await page.getByRole('dialog', { name: 'Delete and redraft this post?' })
    .getByRole('button', { name: 'Delete & redraft' }).click()
  const dialog = compose(page)
  await expect(dialog.getByRole('heading', { name: 'New post' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Post text' })).toHaveValue('say it again')
  await expect(dialog.getByRole('textbox', { name: 'Content warning' })).toHaveValue('cw')
  await expect(dialog.getByRole('combobox', { name: 'Visibility' })).toHaveValue('unlisted')
  await expect(card(page, '1')).toHaveCount(0)
  expect(s.writes).toEqual(['DELETE 1'])
})

test('Edit on a post with a poll says why it cannot, and sends nothing', async ({ page }) => {
  await signIn(page)
  const poll = {
    id: 'p1', expires_at: null, expired: false, multiple: false, votes_count: 3, voters_count: 3,
    options: [{ title: 'yes', votes_count: 2 }, { title: 'no', votes_count: 1 }], emojis: [], voted: false, own_votes: [],
  }
  const s = await fakeServer(page, [own('1', 'a question', { poll })])
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(toaster(page)).toContainText('Caribou cannot edit a post with a poll yet')
  await expect(compose(page)).toBeHidden()
  expect(s.writes).toEqual([])
})

test('editing a post with media keeps the media', async ({ page }) => {
  await signIn(page)
  const image = {
    id: 'm1', type: 'image', url: 'https://example.social/a.png', preview_url: 'https://example.social/a.png',
    remote_url: null, description: 'a cat', blurhash: null, meta: null,
  }
  const s = await fakeServer(page, [own('1', 'teh cat', { media_attachments: [image] as never })])
  await gotoSettled(page, '/home')
  await menu(page, '1').click()
  await card(page, '1').getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = compose(page)
  await expect(dialog.getByText('Media stays as it is.')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('the cat')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(card(page, '1')).toContainText('the cat')
  expect((s.posts.get('1')!.media_attachments as { id: string }[]).map((m) => m.id)).toEqual(['m1'])
})
