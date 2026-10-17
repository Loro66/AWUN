const { test, expect } = require('@playwright/test');
const { openAwun, searchFor, TRACKS } = require('./fixtures');
const { mkdirSync } = require('node:fs');

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page._tasteErrors = errors;
});
test.afterEach(async ({ page }) => { expect(page._tasteErrors).toEqual([]); });

async function openRatings(page, row = page.locator('#trackList .track[data-source="audius"]').first()) {
  await row.locator('.track-queue-menu summary').click();
  await row.locator('[data-rate-track]').click();
  await expect(page.locator('#ratingDialog')).toBeVisible();
}
async function readySearch(page) {
  await openAwun(page); await searchFor(page, 'midnight signal');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
}

test('five ratings save locally, update overlapping collections, survive reload and clear', async ({ page }) => {
  await readySearch(page); await openRatings(page);
  for (const [key, value] of Object.entries({ overall: '5', melody: '5', vocals: '4', rhythm: '5', atmosphere: '4' })) await page.locator(`#rating-${key}`).selectOption(value);
  await expect(page.locator('#ratingScore')).toContainText('4.7 / 5');
  await page.locator('#ratingForm button[type="submit"]').click();
  await expect(page.locator('#ratingDialog')).not.toBeVisible();
  await page.locator('#libraryButton').click();
  for (const id of ['taste-best', 'taste-rhythm', 'taste-atmosphere']) {
    await page.locator(`[data-preference-library="${id}"]`).click();
    await expect(page.locator('#trackList .track')).toHaveCount(1);
  }
  await page.reload(); await page.locator('#libraryButton').click();
  await page.locator('[data-preference-library="taste-best"]').click();
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await openRatings(page); await expect(page.locator('#rating-melody')).toHaveValue('5');
  await page.locator('#ratingClear').click(); await page.locator('#ratingClose').click();
  await expect(page.locator('#trackList .track')).toHaveCount(0);
  expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(1);
});

test('weights reclassify tracks and a custom rule can be edited and deleted', async ({ page }) => {
  await readySearch(page); await openRatings(page);
  await page.locator('#rating-melody').selectOption('5'); await page.locator('#rating-vocals').selectOption('1');
  await page.locator('#ratingForm button[type="submit"]').click();
  await page.locator('#libraryButton').click(); await page.locator('#preferenceSettings summary').click();
  await page.locator('#preferenceName').fill('My melody');
  await page.locator('#preferenceMetric').selectOption('melody'); await page.locator('#preferenceMinimum').fill('4.5');
  await page.locator('#preferenceRuleForm button[type="submit"]').click();
  const id = await page.locator('#preferenceRuleEditor').inputValue();
  await page.locator(`[data-preference-library="${id}"]`).click();
  await expect(page.locator('#resultTitle')).toHaveText('My melody'); await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#preferenceMetric').selectOption('vocals'); await page.locator('#preferenceRuleForm button[type="submit"]').click();
  await expect(page.locator('#trackList .track')).toHaveCount(0);
  await page.locator('#preferenceDelete').click(); await expect(page.locator(`[data-preference-library="${id}"]`)).toHaveCount(0);
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.evaluate(() => {
    window.songvaleTaste.store.updateSettings({ weights: { overall: 0, melody: 5, vocals: 0, rhythm: 0, atmosphere: 0 } });
  });
  await page.locator('[data-preference-library="taste-best"]').click(); await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#weight-vocals').fill('5'); await page.locator('#weight-vocals').dispatchEvent('change');
  await expect(page.locator('#trackList .track')).toHaveCount(0);
});

test('a collection can include unrated playlist-only tracks by artist and source', async ({ page }) => {
  await page.addInitScript(track => localStorage.setItem('awun-playlists-v1', JSON.stringify([{id:'playlist-only', name:'Only here', items:[{position:0,track}]}])), TRACKS.audius[0]);
  await openAwun(page); await page.locator('#libraryButton').click(); await page.locator('#preferenceSettings summary').click();
  await page.locator('#preferenceName').fill('Artist shelf'); await page.locator('#preferenceArtists').fill('awun artist');
  await page.locator('#preferenceSource').selectOption('audius'); await page.locator('#preferenceUnrated').check();
  await page.locator('#preferenceRuleForm button[type="submit"]').click();
  const id = await page.locator('#preferenceRuleEditor').inputValue(); await page.locator(`[data-preference-library="${id}"]`).click();
  await expect(page.locator('#trackList .track')).toHaveCount(1); expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(0);
});

test('ratings are separated by account and included in a full device backup', async ({ page }) => {
  await readySearch(page); await openRatings(page); await page.locator('#rating-overall').selectOption('5');
  await page.locator('#ratingForm button[type="submit"]').click();
  const result = await page.evaluate(() => {
    const taste = window.songvaleTaste, key = window.songvalePreferences.recordingKey(window.awunApp.state.saved[0]);
    const backup = JSON.parse(window.awunStorage.exportState());
    localStorage.setItem('songvale-account-owner-v1','different-account'); window.awunApp.render();
    const other = taste.profile().ratings[key];
    localStorage.removeItem('songvale-account-owner-v1'); window.awunApp.render();
    return { backedUp: Boolean(backup.data['awun-preferences-v1']), other, guest: taste.profile().ratings[key]?.values.overall };
  });
  expect(result).toEqual({ backedUp: true, other: undefined, guest: 5 });
});

test('continuous Wave rotates queries, suppresses cross-source repeats and bounds a long session', async ({ page }) => {
  await readySearch(page);
  const queries = []; let batch = 0;
  await page.route('**/api/v1/search', route => {
    const body = route.request().postDataJSON();
    if (!body.fast) return route.fallback();
    queries.push(body.query); batch++;
    const tracks = Array.from({ length: 25 }, (_, index) => ({ ...TRACKS.audius[0], id: `wave-${batch}-${index}`, title: `Fresh ${batch} ${index}`, artist: `Artist ${batch} ${index % 5}` }));
    tracks.push({ ...tracks[0], id: `alias-${batch}`, source: 'soundcloud' });
    return route.fulfill({ json: { tracks, searched_sources: body.sources, errors: {} } });
  });
  await page.locator('#flowButton').click(); await page.locator('#flowStart').click();
  await expect.poll(() => batch).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.awunApp.state.flow.fetching)).toBe(false);
  for (let turn = 0; turn < 8; turn++) {
    const previous = batch;
    await page.evaluate(() => { window.awunApp.replaceQueue([], 'context'); document.dispatchEvent(new CustomEvent('awun:queue-ended')); });
    await expect.poll(() => batch).toBeGreaterThan(previous);
    await expect.poll(() => page.evaluate(() => window.awunApp.state.flow.fetching)).toBe(false);
  }
  const result = await page.evaluate(() => {
    const state = window.awunApp.state, key = window.songvalePreferences.recordingKey;
    return { results: state.tracks.length, queue: state.queue.length, unique: new Set(state.tracks.map(key)).size, ids: state.tracks.length };
  });
  expect(result.results).toBeLessThanOrEqual(160); expect(result.queue).toBeLessThanOrEqual(80); expect(result.unique).toBe(result.ids);
  expect(new Set(queries).size).toBe(queries.length);
});

test('Wave uses a preference collection as its local seed and continuous mode can be disabled', async ({ page }) => {
  await readySearch(page);
  await page.evaluate(() => {
    const app = window.awunApp, taste = window.songvaleTaste;
    app.toggleSave(app.state.tracks.find(track => track.source === 'audius'));
    taste.store.rate(app.state.saved[0], { overall: 5 }); taste.store.updateSettings({ continuous: false, libraryId: 'taste-best', artistGap: 4 });
  });
  let requests = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/search') requests++; });
  await page.locator('#flowButton').click(); await page.locator('.flow-tuning summary').click();
  await expect(page.locator('#flowContinuous')).not.toBeChecked(); await expect(page.locator('#flowArtistGap')).toHaveValue('4');
  await page.locator('#flowStart').click(); await expect(page.locator('body')).toHaveClass(/flow-active/);
  expect(await page.evaluate(() => window.awunApp.state.tracks.length)).toBe(1); expect(requests).toBe(0);
  await page.evaluate(() => { window.awunApp.replaceQueue([], 'context'); document.dispatchEvent(new CustomEvent('awun:queue-ended')); });
  await expect(page.locator('body')).not.toHaveClass(/flow-active/); expect(requests).toBe(0);
});

test('unavailable remote batches time out, stop retrying and preserve local playback', async ({ page }) => {
  await page.clock.install(); await readySearch(page);
  let requests = 0;
  await page.route('**/api/v1/search', route => { if (route.request().postDataJSON().fast) { requests++; return; } return route.fallback(); });
  await page.locator('#flowButton').click(); await page.locator('#flowStart').click();
  await page.clock.fastForward(12_100); await page.locator('#flowButton').click();
  await expect(page.locator('#flowRetry')).toBeVisible(); await expect(page.locator('#player')).not.toHaveClass(/player-empty/);
  const exhausted = requests; await page.clock.fastForward(60_000); expect(requests).toBe(exhausted);
});

test('cached library renders preserve tab focus and filtering remains bounded with 1500 tracks', async ({ page }) => {
  await page.addInitScript(track => localStorage.setItem('awun-library',JSON.stringify(Array.from({length:1500},(_,i)=>({...track,id:`large-${i}`,title:`Song ${i}`})))), TRACKS.audius[0]);
  await openAwun(page); await page.locator('#libraryButton').click();
  const result = await page.evaluate(() => {
    const app = window.awunApp, tab = document.querySelector('[data-smart-playlist="recent"]'), row = document.querySelector('#trackList .track');
    tab.focus(); const started = performance.now();
    for(let i=0;i<15;i++)app.render();
    return { duration: performance.now()-started, sameTab: tab===document.querySelector('[data-smart-playlist="recent"]'), focused: document.activeElement===tab, sameRow: row===document.querySelector('#trackList .track') };
  });
  expect(result.sameTab).toBe(true); expect(result.focused).toBe(true); expect(result.sameRow).toBe(true);
  await page.locator('#libraryFilter').fill('Song 1499'); await expect(page.locator('#trackList .track')).toHaveCount(1);
  expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(1500);
  test.info().annotations.push({type:'performance',description:`15 warm library renders: ${result.duration.toFixed(1)}ms`});
});

test('rating and collection controls fit narrow and wide screens in both light and dark themes', async ({ page }) => {
  mkdirSync('test-results/feature-qa', { recursive: true });
  await readySearch(page); await openRatings(page);
  for (const theme of ['black', 'white']) {
    for (const width of [1280,390,320]) {
      await page.setViewportSize({width,height:900}); await page.evaluate(theme => { document.documentElement.dataset.theme=theme; }, theme);
      await expect(page.locator('#rating-overall')).toBeVisible();
      const bounds = await page.locator('#ratingDialog').boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({path:`test-results/feature-qa/ratings-${theme}-${width}.png`});
    }
  }
  await page.locator('#ratingClose').click(); await page.locator('#libraryButton').click(); await page.locator('#preferenceSettings summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/feature-qa/preference-rules-320.png',fullPage:true});
});


test('restoring a full device backup restores ratings and collection rules', async ({ page }) => {
  await readySearch(page);
  const restored = await page.evaluate(async () => {
    const taste = window.songvaleTaste, track = window.awunApp.state.tracks[0];
    taste.store.rate(track, { overall: 5 }); taste.store.saveRule({ id: 'restore-me', name: 'Restored' });
    const backup = window.awunStorage.exportState();
    taste.store.rate(track, {}); taste.store.deleteRule('restore-me');
    await window.awunStorage.importState(backup);
    return { rating: taste.values(track).overall, collection: taste.profile().libraries.some(item => item.id === 'restore-me') };
  });
  expect(restored).toEqual({ rating: 5, collection: true });
});
