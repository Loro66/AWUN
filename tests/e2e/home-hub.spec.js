const { test, expect } = require('@playwright/test');
const { openAwun, searchFor, TRACKS } = require('./fixtures');

const music = [TRACKS.audius[0], TRACKS.soundcloud[1], TRACKS.jamendo[0], TRACKS.internet_archive[0], TRACKS.youtube[0], TRACKS.audius[1]];
const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => { const errors = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

async function seedHome(page, { resume = false, theme = 'black', decor = 'full', longTitles = false } = {}) {
  await page.addInitScript(({ tracks, resume, theme, decor, longTitles }) => {
    const songs = tracks.map((track, index) => ({ ...track, artist: ['AWUN Artist', 'Forest Ensemble', 'Silver Collective'][index % 3], title: longTitles ? `${track.title} — a very long recording title that must fit on a narrow screen` : track.title }));
    localStorage.setItem('awun-visual', JSON.stringify({ theme, decor, motion: 'off' }));
    localStorage.setItem('awun-library', JSON.stringify(songs));
    localStorage.setItem('awun-recent', JSON.stringify(songs));
    localStorage.setItem('awun-queue-v1', JSON.stringify({ items: songs.slice(1), mode: 'manual' }));
    if (resume) localStorage.setItem('awun-playback-session-v1', JSON.stringify({ version: 1, track: songs[0], saved_at: Date.parse('2026-09-04T12:40:16.708Z'), position: 73, duration: 214 }));
  }, { tracks: music, resume, theme, decor, longTitles });
}

test('first visit offers working starting points without searching in the background', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().includes('/api/v1/search')) requests.push(request.url()); });
  await openAwun(page);
  await expect(page.locator('#hubRecentEmpty')).toBeVisible();
  await expect(page.locator('#hubResumeCard')).toBeHidden();
  await expect(page.locator('#hubShuffle')).toBeDisabled();
  await expect(page.locator('#hubSourceCount')).toHaveText('Источники: 5');
  expect(requests).toEqual([]);

  await page.locator('#hubSources').click();
  await expect(page.locator('.advanced-search')).toHaveAttribute('open', '');
  await page.locator('.advanced-search summary').click();
  await page.locator('#hubWave').click();
  await expect(page.locator('#flowPanel')).toBeVisible();
  await page.locator('#flowClose').click();
  await page.locator('#welcomeSearch').click();
  await expect(page.locator('#searchInput')).toBeFocused();
  await page.locator('#recommendationGrid .hub-mood-focus').click();
  await expect(page.locator('#searchInput')).toHaveValue('focus instrumental');
  await expect(page.locator('#trackList .track').first()).toBeVisible();
});

test('home resumes a saved position, keeps controls in sync and returns without reloading audio', async ({ page }) => {
  await seedHome(page, { resume: true });
  await openAwun(page);
  await expect(page.locator('#hubResumeMeta')).toContainText('1:13');
  await expect(page.locator('#hubResume')).toContainText('Продолжить слушать');
  await page.locator('#hubResume').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#hubResume')).toContainText('Пауза');
  const currentCard = page.locator('#recentList .hub-track.active');
  await expect(currentCard.locator('.hub-track-icon')).toHaveText('Ⅱ');
  await currentCard.locator('.hub-track-play').click();
  await expect(page.locator('body')).not.toHaveClass(/is-playing/);
  await expect(page.locator('#hubResume')).toContainText('Продолжить слушать');

  const save = currentCard.locator('.hub-track-save');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await expect(save).toBeFocused();
  await expect(page.locator('#hubSavedCount')).toHaveText('5');
  await page.locator('#hubResume').click();
  await searchFor(page, 'midnight signal');
  const audioIdentity = await page.locator('#audio').elementHandle();
  await page.locator('.site-header .logo').click();
  await expect(page.locator('#homeSections')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  expect(await audioIdentity.evaluate(audio => audio === document.querySelector('#audio'))).toBe(true);
  await page.locator('#hubRecent').click();
  await expect(page.locator('#resultTitle')).toHaveText('Недавно');
  await expect(page.locator('#trackList .track')).toHaveCount(6);
});

test('home search history survives reload, repeats a query and can be cleared', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.site-header .logo').click();
  await expect(page).not.toHaveURL(/(?:[?&])q=/);
  await page.reload();
  await expect(page.locator('#homeSections')).toBeVisible();
  await expect(page.locator('#hubSearchChips button')).toHaveText(['midnight signal']);
  await page.locator('#hubSearchChips button').click();
  await expect(page.locator('#searchInput')).toHaveValue('midnight signal');
  await expect(page.locator('#trackList .track').first()).toBeVisible();
  await page.locator('.site-header .logo').click();
  await expect(page.locator('#hubSearchChips button')).toHaveCount(1);
  await page.locator('#hubClearSearches').click();
  await expect(page.locator('#hubSearchHistory')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('awun-search-history-v1'))).toBeNull();
});

test('home shuffle builds a complete queue and artist shortcuts search by name', async ({ page }) => {
  await seedHome(page, { resume: true });
  await openAwun(page);
  await page.locator('#hubShuffle').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  const session = await page.evaluate(() => ({ active: window.awunApp.state.active.id, queue: window.awunApp.state.queue.map(track => track.id) }));
  expect(new Set([session.active, ...session.queue])).toEqual(new Set(music.map(track => track.id)));
  expect(session.queue).toHaveLength(music.length - 1);
  await expect(page.locator('#hubQueueCount')).toHaveText('5');
  await page.locator('#hubQueue').click();
  await expect(page.locator('#queueList .queue-item')).toHaveCount(5);
  await page.locator('#queueClose').click();
  const artist = await page.locator('#hubArtists .hub-artist strong').first().textContent();
  await page.locator('#hubArtists .hub-artist').first().click();
  await expect(page.locator('#searchInput')).toHaveValue(artist);
  await expect(page.locator('#trackList .track').first()).toBeVisible();
});

for (const setup of [
  { width: 1920, theme: 'black' },
  { width: 1280, theme: 'white' },
  { width: 1000, theme: 'black', decor: 'minimal' },
  { width: 390, theme: 'white' },
  { width: 320, theme: 'black' },
]) {
  test(`home fits ${setup.width}px in ${setup.theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: setup.width, height: 900 });
    await seedHome(page, { ...setup, resume: true, longTitles: true });
    await openAwun(page);
    await expect(page.locator('#recentList .hub-track')).toHaveCount(6);
    await expect(page.locator('#recommendationGrid .hub-mood')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(setup.width);
    for (const selector of ['#hubResume', '#hubLibrary', '#hubShuffle', '.hub-track-play', '.hub-track-save', '.hub-mood']) {
      for (const control of await page.locator(selector).all()) {
        const bounds = await control.boundingBox();
        expect(bounds.x, selector).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width, selector).toBeLessThanOrEqual(setup.width);
        expect(bounds.height, selector).toBeGreaterThanOrEqual(28);
      }
    }
    await page.locator('#languageButton').click();
    await expect(page.locator('#hubTitle')).toHaveText('Home');
    await expect(page.locator('#recommendationGrid')).toContainText('Find your focus');
    await expect(page.locator('#hubResumeMeta')).toContainText('Resume at 1:13');
    await expect(page.locator('#nowTitle')).toHaveText(await page.evaluate(() => window.awunApp.state.active.title));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(setup.width);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: setup.width < 1100 });
  });
}

for (const width of [1280, 390]) {
  test(`home overview ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await seedHome(page, { resume: true });
    await openAwun(page);
    await page.evaluate(() => document.activeElement?.blur());
    await expect(page).toHaveScreenshot(`home-${width}.png`, { fullPage: width < 1100, maxDiffPixelRatio: 0.02 });
  });
}
