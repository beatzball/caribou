import { test, expect } from '@playwright/test';

test('SSR renders without JavaScript (DSD in source)', async ({ request }) => {
  const response = await request.get('/');
  const body = await response.text();
  expect(body).toContain('shadowrootmode');
});

test('__litro_data__ is injected into HTML', async ({ request }) => {
  const response = await request.get('/');
  const body = await response.text();
  expect(body).toContain('__litro_data__');
});

test('page-index is visible after hydration', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('page-index');
  await expect(page.locator('page-index')).toBeVisible();
});
