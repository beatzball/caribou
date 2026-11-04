import { expect, test, type Page } from './_fixtures.js'
import { collectErrors, signIn } from './_moderation.js'
import { boostOf, gotoSettled, poll, pollIn, pollPost, pollServer } from './_polls.js'

// Polls in a post: results, voting, and the builder in compose (#55).

const toaster = (page: Page) => page.locator('caribou-toaster')

test('single choice: pick one, Vote, and the post and its boost both show the vote', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  const post = pollPost('1', poll('p1'))
  const s = await pollServer(page, [post, boostOf('w1', post)], [poll('p1')])
  await gotoSettled(page, '/home')
  const own = pollIn(page, '1')
  const boosted = pollIn(page, 'w1')
  await expect(own.getByRole('radio')).toHaveCount(3)
  await expect(own.getByText('Choose one', { exact: true })).toBeVisible()
  const vote = own.getByRole('button', { name: 'Vote' })
  await expect(vote).toBeDisabled()
  await own.getByRole('radio', { name: 'Coffee' }).check()
  await vote.click()
  await expect(own).toContainText('You voted')
  await expect(own).toContainText('5 people')
  await expect(own.locator('li.result').nth(1)).toContainText('40%')
  await expect(own.locator('li.result').nth(1)).toContainText(', your choice')
  // Focus moves to the results, which replaced the choices.
  await expect(own.getByRole('list', { name: 'Poll results' })).toBeFocused()
  await expect(boosted).toContainText('You voted')
  await expect(boosted.getByRole('radio')).toHaveCount(0)
  expect(s.votes).toEqual([{ id: 'p1', choices: [1] }])
  expect(errors).toEqual([])
})

test('multiple choice: checkboxes, several picks in one vote', async ({ page }) => {
  await signIn(page)
  const s = await pollServer(page, [pollPost('1', poll('p1', { multiple: true }))], [poll('p1', { multiple: true })])
  await gotoSettled(page, '/home')
  const p = pollIn(page, '1')
  await expect(p.getByText('Choose one or more', { exact: true })).toBeVisible()
  await p.getByRole('checkbox', { name: 'Water' }).check()
  await p.getByRole('checkbox', { name: 'Tea' }).check()
  await p.getByRole('button', { name: 'Vote' }).click()
  await expect(p).toContainText('You voted')
  await expect(p.getByText(', your choice')).toHaveCount(2)
  expect(s.votes).toEqual([{ id: 'p1', choices: [0, 2] }])
})

test('a failed vote rolls back: the choices come back, a toast says so, and the poll is read again', async ({ page }) => {
  await signIn(page)
  const s = await pollServer(page, [pollPost('1', poll('p1'))], [poll('p1')])
  s.fail = true
  await gotoSettled(page, '/home')
  const p = pollIn(page, '1')
  await p.getByRole('radio', { name: 'Tea' }).check()
  await p.getByRole('button', { name: 'Vote' }).click()
  await expect(toaster(page)).toContainText('Could not send your vote. Try again.')
  await expect(p.getByRole('radio', { name: 'Tea' })).toBeChecked()
  await expect(p.getByRole('button', { name: 'Vote' })).toBeFocused()
  await expect(p).toContainText('4 people')
  await expect.poll(() => s.reads).toEqual(['p1'])
})

test('an ended poll shows results only, with the winner marked', async ({ page }) => {
  await signIn(page)
  const ended = poll('p1', { expired: true, expires_at: '2024-01-02T00:00:00.000Z' })
  await pollServer(page, [pollPost('1', ended)], [ended])
  await gotoSettled(page, '/home')
  const p = pollIn(page, '1')
  await expect(p).toContainText('Ended')
  await expect(p.getByRole('radio')).toHaveCount(0)
  await expect(p.locator('li.result[data-leading]')).toHaveCount(1)
  await expect(p.locator('li.result[data-leading]')).toContainText('Tea')
})

test('a poll the reader voted on shows their choices; Refresh reads it again', async ({ page }) => {
  await signIn(page)
  const voted = poll('p1', { voted: true, own_votes: [2] })
  const s = await pollServer(page, [pollPost('1', voted)], [{ ...voted, votes_count: 9, voters_count: 9 }])
  await gotoSettled(page, '/home')
  const p = pollIn(page, '1')
  await expect(p.locator('li.result').nth(2)).toContainText(', your choice')
  await p.getByRole('button', { name: 'Refresh poll results' }).click()
  await expect(p).toContainText('9 people')
  expect(s.reads).toEqual(['p1'])
})

test('hidden totals: no shares until the poll ends', async ({ page }) => {
  await signIn(page)
  const hidden = poll('p1', { voted: true, own_votes: [0], options: [{ title: 'Tea', votes_count: null }, { title: 'Coffee', votes_count: null }] })
  await pollServer(page, [pollPost('1', hidden)], [hidden])
  await gotoSettled(page, '/home')
  const p = pollIn(page, '1')
  await expect(p).toContainText('Results show when the poll ends.')
  await expect(p.locator('.share')).toHaveCount(0)
})

test('compose: a poll with three options, a duration and several choices is posted', async ({ page }) => {
  const errors = collectErrors(page)
  await signIn(page)
  await pollServer(page, [], [])
  const posted: Record<string, unknown>[] = []
  await page.route('https://example.social/api/v1/statuses', (route) => {
    posted.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(pollPost('new', poll('pn'))) })
  })
  await gotoSettled(page, '/home')
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog', { name: 'New post' })
  await dialog.getByRole('textbox', { name: 'Post text' }).fill('Which drink?')
  await dialog.getByRole('button', { name: 'Poll' }).click()
  const group = dialog.getByRole('group', { name: 'Poll' })
  await expect(group.getByRole('textbox', { name: 'Option 1' })).toBeFocused()
  // A poll and media exclude each other.
  await expect(dialog.getByRole('button', { name: 'Add images or video' })).toHaveAttribute('aria-disabled', 'true')
  await group.getByRole('textbox', { name: 'Option 1' }).fill('Tea')
  await group.getByRole('textbox', { name: 'Option 2' }).fill('tea')
  await expect(group).toContainText('Two options are the same.')
  await expect(dialog.getByRole('button', { name: 'Post' })).toBeDisabled()
  await group.getByRole('textbox', { name: 'Option 2' }).fill('Coffee')
  await group.getByRole('button', { name: 'Add option' }).click()
  await expect(group.getByRole('textbox', { name: 'Option 3' })).toBeFocused()
  await page.keyboard.type('Water')
  await group.getByLabel('Ends in').selectOption({ label: '3 days' })
  await group.getByRole('checkbox', { name: 'Allow several choices' }).check()
  await dialog.getByRole('button', { name: 'Post' }).click()
  await expect(dialog).toBeHidden()
  expect(posted).toEqual([{
    status: 'Which drink?', visibility: 'public',
    poll: { options: ['Tea', 'Coffee', 'Water'], expires_in: 259200, multiple: true, hide_totals: false },
  }])
  expect(errors).toEqual([])
})

test('compose: a draft with media cannot add a poll', async ({ page }) => {
  await signIn(page)
  await pollServer(page, [], [])
  await page.addInitScript(() => {
    localStorage.setItem('caribou.drafts.alice@example.social', JSON.stringify({
      new: { text: 'pic', spoilerText: '', cw: false, visibility: 'public', inReplyToId: null, idempotencyKey: 'k',
        media: [{ id: 'm1', type: 'image', url: 'https://example.social/a.png', previewUrl: null, description: '' }] },
    }))
  })
  await gotoSettled(page, '/home')
  await page.keyboard.press('n')
  const dialog = page.getByRole('dialog', { name: 'New post' })
  const toggle = dialog.getByRole('button', { name: 'Poll' })
  await expect(toggle).toHaveAttribute('aria-disabled', 'true')
  // It stays in the tab order, so a keyboard reader hears why; a press does nothing.
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('group', { name: 'Poll' })).toHaveCount(0)
})

// A signed-out reader (results, no vote) is in polls-ssr.spec.ts.
