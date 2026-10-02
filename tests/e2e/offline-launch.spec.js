const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'allow' });

test('installed shell opens from cache while the server is unreachable', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#hubTitle')).toBeVisible();
  await context.setOffline(false);
});
