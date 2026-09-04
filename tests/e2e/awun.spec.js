const { test, expect } = require('@playwright/test');
const { openAwun, searchFor } = require('./fixtures');
const pageErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
});

test('progressive search renders the first provider before the slowest provider', async ({ page }) => {
  await openAwun(page, { delays: { youtube: 20, soundcloud: 450, audius: 700, jamendo: 900, internet_archive: 1_100 } });
  await page.locator('#searchInput').fill('midnight signal');
  await page.locator('#searchForm').evaluate(form => form.requestSubmit());

  await expect(page.locator('#trackList .track').first()).toBeVisible();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#trackList .track')).toHaveCount(8);
});

test('My Wave starts playback and fills a persistent queue', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#flowButton').click();
  await page.locator('#flowStart').click();

  await expect(page.locator('body')).toHaveClass(/flow-active/);
  await expect(page.locator('#player')).not.toHaveClass(/player-empty/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('awun-queue-v1') || '{}').items?.length || 0)).toBeGreaterThan(0);
});

test('an unavailable YouTube embed switches to the matching connected source', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'unavailable signal');
  const youtube = page.locator('#trackList .track[data-source="youtube"]');
  await youtube.locator('.play').click();

  await expect(page.locator('#nowSource')).toHaveText('Audius');
  await expect(page.locator('#message')).toContainText('Audius');
  await expect(page.locator('#youtubeDock')).toBeHidden();
});

test('manual queue survives a page reload and remains reorderable', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  const rows = page.locator('#trackList .track');
  await rows.nth(2).locator('.track-queue-menu summary').click();
  await rows.nth(2).locator('.track-queue-menu button').last().click();
  await rows.nth(3).locator('.track-queue-menu summary').click();
  await rows.nth(3).locator('.track-queue-menu button').last().click();
  await page.reload();

  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track').first().locator('.play').click();
  await page.locator('#queueToggle').click();
  await expect(page.locator('#queueList .queue-item')).toHaveCount(2);
  const secondTitle = await page.locator('#queueList .queue-item').nth(1).locator('strong').textContent();
  await page.locator('#queueList .queue-item').nth(1).locator('.queue-controls button').first().click();
  await expect(page.locator('#queueList .queue-item').first().locator('strong')).toHaveText(secondTitle);
});

for (const viewport of [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1280', width: 1280, height: 900 },
  { name: 'compact-1000', width: 1000, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
]) {
  test(`pre-release layout ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openAwun(page);
    await searchFor(page, 'midnight signal');
    await page.locator('#trackList .track').first().locator('.play').click();
    await expect(page).toHaveScreenshot(`${viewport.name}.png`, { fullPage: true });
  });
}
