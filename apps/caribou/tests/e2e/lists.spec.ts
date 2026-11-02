import { expect, test } from './_fixtures.js'
import {
  API, BOB, CAROL, card, collectErrors, gotoSettled, json, relationship, signIn, status,
} from './_moderation.js'
import { list, openBob, serveLists } from './_lists.js'

// Lists (#51): /lists manages the reader's lists, /lists/[id] reads one,
// and a profile's menu adds its account to lists.

test.describe('signed out', () => {
  test('/lists and a list\'s page show the sign-in placeholder', async ({ page }) => {
    const errors = collectErrors(page)
    await gotoSettled(page, '/lists')
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
    await expect(page.locator('caribou-auth-required')).toContainText('/lists shows your lists.')
    // The rail has no Lists item for a reader with no account.
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Lists' })).toBeHidden()
    await gotoSettled(page, '/lists/3')
    await expect(page.locator('caribou-auth-required')).toContainText('one of your lists')
    expect(errors).toEqual([])
  })
})

test('the server sends the shell of a list page; the browser fills it and hydrates cleanly', async ({ page, request }) => {
  // A list needs the reader's token, which only the browser has: the
  // server can send nothing of the list, with or without JavaScript.
  const html = await (await request.get('/lists/3')).text()
  expect(html).toContain('<page-lists-id')
  expect(html).toContain('caribou-auth-required')
  expect(html).not.toContain('caribou-status-card')

  const errors = collectErrors(page)
  await signIn(page)
  await serveLists(page, [list('3', 'Friends')])
  await page.route(`${API}/v1/timelines/list/3*`, (route) => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill(json(q.has('max_id') || q.has('since_id') ? [] : [status('1', BOB), status('2', CAROL)]))
  })
  await gotoSettled(page, '/lists/3')
  await expect(page.getByRole('heading', { level: 1, name: 'Friends' })).toBeVisible()
  await expect(card(page, '1')).toContainText('post 1')
  await expect(card(page, '2')).toContainText('post 2')
  // The rail marks Lists in the account's nav.
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Lists' })).toBeVisible()
  expect(errors).toEqual([])
})

test('a list timeline honors the reader\'s home filters', async ({ page }) => {
  await signIn(page)
  await serveLists(page, [list('3', 'Friends')])
  const hide = { filter: { id: 'f', title: 'Politics', context: ['home'], filter_action: 'hide', expires_at: null, keywords: [], statuses: [] }, keyword_matches: ['x'], status_matches: null }
  await page.route(`${API}/v1/timelines/list/3*`, (route) => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill(json(q.has('max_id') || q.has('since_id') ? [] : [status('1', BOB), status('2', BOB, [hide])]))
  })
  await gotoSettled(page, '/lists/3')
  await expect(card(page, '1')).toContainText('post 1')
  await expect(card(page, '2')).toBeHidden()
})

test('create, rename and delete a list on /lists', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  const server = await serveLists(page, [list('1', 'Friends')])
  await gotoSettled(page, '/lists')
  await expect(page.getByRole('link', { name: 'Friends' })).toHaveAttribute('href', '/lists/1')

  // Create: the title field has focus; Enter submits.
  await page.getByRole('button', { name: 'New list' }).click()
  const create = page.getByRole('dialog', { name: 'New list' })
  await expect(create.getByLabel('Title')).toBeFocused()
  await page.keyboard.type('Cats')
  await create.getByRole('radio', { name: 'No one' }).check()
  await create.getByLabel('Title').press('Enter')
  await expect(create).toBeHidden()
  const cats = page.getByRole('link', { name: 'Cats' })
  await expect(cats).toBeFocused()
  expect(server.lists().find((l) => l.title === 'Cats')).toMatchObject({ replies_policy: 'none' })

  // Rename.
  await page.getByRole('button', { name: 'Edit Cats' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit list' })
  await expect(edit.getByLabel('Title')).toHaveValue('Cats')
  await expect(edit.getByRole('radio', { name: 'No one' })).toBeChecked()
  // The server sends `exclusive`, so the dialog offers it.
  await expect(edit.getByRole('checkbox', { name: 'Hide these posts from Home' })).toBeVisible()
  await edit.getByLabel('Title').fill('Kittens')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name: 'Kittens' })).toBeVisible()

  // Delete asks first.
  await page.getByRole('button', { name: 'Delete Kittens' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete "Kittens"?' })
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('link', { name: 'Kittens' })).toHaveCount(0)
  await expect.poll(() => server.writes).toEqual(['create Cats', 'update 100 Kittens', 'delete 100'])
  expect(errors).toEqual([])
})

test('a failed delete brings the list back and says so', async ({ page }) => {
  await signIn(page)
  await page.route(`${API}/v1/lists`, (route) => route.fulfill(json([list('1', 'Friends')])))
  await page.route(`${API}/v1/lists/1`, (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    : route.fallback())
  await gotoSettled(page, '/lists')
  await page.getByRole('button', { name: 'Delete Friends' }).click()
  await page.getByRole('dialog', { name: 'Delete "Friends"?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('caribou-toaster')).toContainText('Couldn\'t delete the list "Friends".')
  await expect(page.getByRole('link', { name: 'Friends' })).toBeVisible()
})

test('add an account to a list from its profile, then remove it on the list', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await page.route(`${API}/v1/accounts/relationships*`, (route) => route.fulfill(json([relationship('b1', { following: true })])))
  const members: Record<string, unknown[]> = { 1: [] }
  const server = await serveLists(page, [list('1', 'Friends'), list('2', 'News')], members)
  await page.route(`${API}/v1/accounts/b1/lists`, (route) => route.fulfill(json([list('2', 'News')])))
  await openBob(page)

  const header = page.locator('caribou-profile-header')
  await header.getByRole('button', { name: 'More actions for @bob' }).click()
  await header.getByRole('button', { name: 'Add to lists' }).click()
  const picker = page.getByRole('dialog', { name: 'Lists for @bob' })
  await expect(picker.getByRole('checkbox', { name: 'News' })).toBeChecked()
  const friends = picker.getByRole('checkbox', { name: 'Friends' })
  await expect(friends).not.toBeChecked()
  await friends.check()
  await expect.poll(() => server.writes).toEqual(['add b1 1'])
  await picker.getByRole('button', { name: 'Done' }).click()
  await expect(picker).toBeHidden()
  await expect(header.getByRole('button', { name: 'More actions for @bob' })).toBeFocused()

  // On the list, Members shows Bob with Remove.
  members[1] = [BOB]
  await page.route(`${API}/v1/timelines/list/1*`, (route) => route.fulfill(json([])))
  await page.evaluate(() => {
    history.pushState(null, '', '/lists/1')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Friends' })).toBeVisible()
  await expect(page.getByText('No posts in this list yet.')).toBeVisible()
  const toggle = page.getByRole('button', { name: 'Members' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByRole('region', { name: 'Members' })
  await expect(panel.getByRole('link', { name: /BOB/ })).toHaveAttribute('href', '/@bob@example.social')
  await panel.getByRole('button', { name: 'Remove @bob' }).click()
  await expect(panel.getByText('No one is in this list yet.')).toBeVisible()
  await expect.poll(() => server.writes).toEqual(['add b1 1', 'remove b1 1'])
  expect(errors).toEqual([])
})

test('a failed add unchecks the box and says why', async ({ page }) => {
  await signIn(page)
  await page.route(`${API}/v1/accounts/relationships*`, (route) => route.fulfill(json([relationship('b1')])))
  await page.route(`${API}/v1/lists`, (route) => route.fulfill(json([list('1', 'Friends')])))
  await page.route(`${API}/v1/accounts/b1/lists`, (route) => route.fulfill(json([])))
  await page.route(`${API}/v1/lists/1/accounts`, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Record not found"}' }))
  await openBob(page)
  const header = page.locator('caribou-profile-header')
  await header.getByRole('button', { name: 'More actions for @bob' }).click()
  await header.getByRole('button', { name: 'Add to lists' }).click()
  const picker = page.getByRole('dialog', { name: 'Lists for @bob' })
  await expect(picker.getByText('Only accounts you follow can be added to a list.')).toBeVisible()
  const box = picker.getByRole('checkbox', { name: 'Friends' })
  await box.check()
  await expect(page.locator('caribou-toaster')).toContainText('Couldn\'t add @bob to the list "Friends".')
  await expect(box).not.toBeChecked()
})
