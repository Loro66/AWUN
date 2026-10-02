const { test, expect } = require('@playwright/test');
const { openAwun } = require('./fixtures');

test.use({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
});

test('iPhone visitors get Safari installation steps, which can be dismissed', async ({ page }) => {
  await openAwun(page);
  const guide = page.locator('#iosInstallGuide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('На экран Домой');
  await page.locator('#iosInstallDismiss').click();
  await expect(guide).toBeHidden();
  await page.reload();
  await expect(guide).toBeHidden();
});

test('installed iPhone app does not show installation steps', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await openAwun(page);
  await expect(page.locator('#iosInstallGuide')).toBeHidden();
});
