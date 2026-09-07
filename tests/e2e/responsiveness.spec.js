const { test, expect } = require('@playwright/test');
const { openAwun, searchFor, TRACKS } = require('./fixtures');
const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test('startup checks health once and shows loading feedback before results', async ({ page }) => {
  let healthRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/health') healthRequests++; });
  await openAwun(page, { delays: { youtube: 800, soundcloud: 800, audius: 800, jamendo: 800, internet_archive: 800 } });
  expect(healthRequests).toBe(1);
  await page.locator('#searchInput').fill('forest');
  await page.locator('#searchInput').press('Enter');
  await expect(page.locator('#results .skeleton')).toHaveCount(4);
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#cancelSearch')).toBeVisible();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
});

test('late providers preserve the first result, its focus and its open menu', async ({ page }) => {
  await openAwun(page, { delays: { audius: 10, youtube: 900, soundcloud: 1100, jamendo: 1300, internet_archive: 1500 } });
  await searchFor(page, 'midnight signal');
  const first = page.locator('#trackList .track').first();
  const firstId = await first.getAttribute('data-track-id');
  await first.locator('.save').click();
  await expect(first.locator('.save')).toBeFocused();
  await first.locator('.track-queue-menu summary').click();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(first).toHaveAttribute('data-track-id', firstId);
  await expect(first.locator('.track-queue-menu')).toHaveAttribute('open', '');
  await expect(first.locator('.track-queue-menu summary')).toBeFocused();
});

test('cancel keeps partial results and permits another search', async ({ page }) => {
  await openAwun(page, { delays: { audius: 10, youtube: 2000, soundcloud: 2000, jamendo: 2000, internet_archive: 2000 } });
  await searchFor(page, 'midnight signal');
  await page.locator('#cancelSearch').click();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#trackList .track')).toHaveCount(2);
  await expect(page.locator('#message')).toContainText('Поиск остановлен');
  await page.locator('#retrySearch').click();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#trackList .track')).toHaveCount(8);
});

test('opening the library prevents a pending search from replacing its screen', async ({ page }) => {
  await openAwun(page, { delays: { youtube: 900, soundcloud: 900, audius: 900, jamendo: 900, internet_archive: 900 } });
  await page.locator('#searchInput').fill('midnight signal');
  await page.locator('#searchInput').press('Enter');
  await page.locator('#libraryButton').click();
  await expect(page.locator('#libraryButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#trackList .track')).toHaveCount(0);
  expect(await page.evaluate(() => window.awunApp.state.controller)).toBeNull();
});

test('a hanging source reaches a deadline and offers retry', async ({ page }) => {
  await page.clock.install();
  await openAwun(page);
  await page.route('**/api/v1/search', () => {});
  await page.locator('#searchInput').fill('slow source');
  await page.locator('#searchInput').press('Enter');
  await expect(page.locator('#cancelSearch')).toBeVisible();
  await page.clock.fastForward(14_100);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#retrySearch')).toBeVisible();
  await expect(page.locator('#trackList .skeleton')).toHaveCount(0);
});

test('waveform seeks without pausing and the play icon follows actual pause state', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  const row = page.locator('#trackList .track[data-source="audius"]').first();
  await row.locator('.play').click();
  const wave = row.locator('.track-waveform');
  const box = await wave.boundingBox();
  await wave.click({ position: { x: box.width * .6, y: box.height / 2 } });
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(125);
  await expect(row.locator('.play')).toHaveText('Ⅱ');
  await wave.press('Home');
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.currentTime)).toBe(0);
  await wave.press('ArrowRight');
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.currentTime)).toBe(5);
  await row.locator('.play').click();
  await expect(row.locator('.play')).toHaveText('▶');
});

test('a large library is rendered in pages without losing tracks', async ({ page }) => {
  await page.addInitScript(track => {
    localStorage.setItem('awun-library', JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ ...track, id: `test-${i}`, title: `Track ${i}` }))));
  }, TRACKS.audius[0]);
  await openAwun(page);
  await page.locator('#libraryButton').click();
  await expect(page.locator('#resultCount')).toContainText('1500');
  await expect(page.locator('#trackList .track')).toHaveCount(60);
  await page.locator('#loadMoreTracks').click();
  await expect(page.locator('#trackList .track')).toHaveCount(120);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library')).length)).toBe(1500);
});

test('a stale saved-link lookup cannot replace a newer playback choice', async ({ page }) => {
  await page.addInitScript(tracks => localStorage.setItem('awun-library', JSON.stringify(tracks)), [TRACKS.audius[0], TRACKS.youtube[0]]);
  await openAwun(page);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let lookupStarted;
  const started = new Promise(resolve => { lookupStarted = resolve; });
  await page.route('**/api/v1/search', async route => {
    lookupStarted();
    await waiting;
    await route.fulfill({ status: 503, json: { detail: 'Temporary failure' } });
  });
  await page.locator('#libraryButton').click();
  const saved = page.locator('#trackList .track[data-source="audius"]');
  await saved.locator('.play').click();
  await started;
  await expect(saved).toHaveAttribute('aria-busy', 'true');
  await page.locator('#trackList .track[data-source="youtube"] .play').click();
  await expect(page.locator('#nowSource')).toHaveText('YouTube');
  release();
  await expect(saved).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#nowSource')).toHaveText('YouTube');
});

for (const width of [1920, 1280, 1000, 390]) {
  for (const theme of ['black', 'white']) {
    test(`readable controls ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem('awun-visual', JSON.stringify({ theme: value, motion: 'off' })), theme);
      await openAwun(page);
      await searchFor(page, 'midnight signal');
      await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
      await page.locator('#trackList .track[data-source="audius"] .play').first().click();
      await expect(page.locator('.up-next')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const row = page.locator('#trackList .track').first();
      const textStyle = await row.evaluate(element => {
        const text = getComputedStyle(element.querySelector('.name strong'));
        const surface = getComputedStyle(element);
        const numbers = color => color.match(/[\d.]+/g).map(Number);
        const composite = (fg, bg) => fg.slice(0, 3).map((value, i) => value * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
        const background = composite(numbers(surface.backgroundColor), numbers(getComputedStyle(document.documentElement).backgroundColor));
        const foreground = composite(numbers(text.color), background);
        const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        const l = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return { backgroundImage: surface.backgroundImage, fontSize: parseFloat(text.fontSize), contrast: (l[0] + .05) / (l[1] + .05) };
      });
      expect(textStyle.backgroundImage).toBe('none');
      expect(textStyle.fontSize).toBeGreaterThanOrEqual(13);
      expect(textStyle.contrast).toBeGreaterThanOrEqual(4.5);
      for (const selector of ['.play', '.save', '.track-queue-menu summary', '.track-waveform']) {
        const bounds = await row.locator(selector).boundingBox();
        expect(bounds.width).toBeGreaterThanOrEqual(28);
        expect(bounds.height).toBeGreaterThanOrEqual(28);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: testInfo.outputPath('screen.png') });
    });
  }
}
