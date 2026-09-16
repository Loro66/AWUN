const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { openAwun, searchFor } = require('./fixtures');

test('capture redesigned player dock', async ({ page }) => {
  mkdirSync('release-captures', { recursive: true });
  await page.setViewportSize({ width: 1600, height: 900 });
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await expect(page.locator('#player')).toBeVisible();
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: 'release-captures/songvale-player-dock.png', animations: 'disabled' });
});
