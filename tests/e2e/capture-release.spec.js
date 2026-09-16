const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { openAwun } = require('./fixtures');

test('capture SONGVALE quiet forest surfaces', async ({ browser }) => {
  mkdirSync('release-captures', { recursive: true });

  const desktop = await browser.newPage({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
  await openAwun(desktop);
  await desktop.evaluate(() => document.activeElement?.blur());
  await expect(desktop.locator('#welcomePanel')).toBeVisible();
  await desktop.screenshot({ path: 'release-captures/songvale-home.png', animations: 'disabled' });
  await desktop.locator('#welcomeImport').click();
  await expect(desktop.locator('#importPanel')).toBeVisible();
  await desktop.screenshot({ path: 'release-captures/songvale-transfer.png', animations: 'disabled' });
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  await openAwun(mobile);
  await mobile.evaluate(() => document.activeElement?.blur());
  await expect(mobile.locator('#welcomePanel')).toBeVisible();
  await mobile.screenshot({ path: 'release-captures/songvale-mobile.png', fullPage: true, animations: 'disabled' });
  await mobile.close();
});
