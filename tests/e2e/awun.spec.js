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

test('an available YouTube track keeps the official player visible and minimizable', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  const youtube = page.locator('#trackList .track[data-source="youtube"]').first();
  await youtube.locator('.play').click();

  await expect(page.locator('#nowSource')).toHaveText('YouTube');
  await expect(page.locator('#youtubeDock')).toBeVisible();
  await page.locator('#minimizeVideo').click();
  await expect(page.locator('#youtubeDock')).toHaveClass(/minimized/);
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
  test(`pre-release layout ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openAwun(page);
    await searchFor(page, 'midnight signal');
    await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await expect(page.locator('#nowSource')).toHaveText('Audius');
    const layout = await page.evaluate(() => {
      const bounds = selector => {
        const element = document.querySelector(selector);
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return { selector, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height, visible: style.display !== 'none' && rect.width > 0 && rect.height > 0 };
      };
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        player: bounds('#player'), controls: ['#nowTitle', '#playPause', '#waveProgress', '#queueToggle', '#muteButton', '#volume'].map(bounds) };
    });
    await testInfo.attach('player-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
    await expect(page.locator('.window-chrome, .player-menu')).toHaveCount(0);
    for (const control of await page.locator('.player-tools .now-source, .player-tools .close, .player .flow-feedback').all()) {
      await expect(control).toBeHidden();
    }
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.player.bottom).toBeCloseTo(layout.height, 0);
    expect(layout.player.height).toBeLessThanOrEqual(120);
    for (const control of layout.controls.filter(item => item.visible)) {
      expect(control.x, `${control.selector} left edge`).toBeGreaterThanOrEqual(layout.player.x - 1);
      expect(control.y, `${control.selector} top edge`).toBeGreaterThanOrEqual(layout.player.y - 1);
      expect(control.right, `${control.selector} right edge`).toBeLessThanOrEqual(layout.player.right + 1);
      expect(control.bottom, `${control.selector} bottom edge`).toBeLessThanOrEqual(layout.player.bottom + 1);
    }
    await expect(page).toHaveScreenshot(`${viewport.name}.png`);
  });
}
