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

test('page-landing is visible after hydration', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('page-landing');
  await expect(page.locator('page-landing')).toBeVisible();
});
