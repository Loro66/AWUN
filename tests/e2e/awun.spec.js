const { test, expect } = require('@playwright/test');
const { openAwun, searchFor, TRACKS } = require('./fixtures');
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

test('repeat search shows cached results immediately and refreshes them in background', async ({ page }) => {
  await openAwun(page, { delays: { youtube: 650, soundcloud: 650, audius: 650, jamendo: 650, internet_archive: 650 } });
  await searchFor(page, 'midnight signal');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(page.locator('#searchInput')).toBeVisible();
  await page.locator('#searchInput').fill('midnight signal');
  await page.locator('#searchForm').evaluate(form => form.requestSubmit());

  await expect(page.locator('#trackList .track').first()).toBeVisible();
  await expect(page.locator('#trackList .skeleton')).toHaveCount(0);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#message')).toContainText('Показаны результаты с устройства');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
});

test('last playback session returns paused at the saved position after reload', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await expect(page.locator('#nowSource')).toHaveText('Audius');
  await page.locator('#audio').evaluate(audio => { audio.currentTime = 73; });
  await page.reload();

  await expect(page.locator('#player')).not.toHaveClass(/player-empty/);
  await expect(page.locator('#nowTitle')).toHaveText('Midnight Signal');
  await expect(page.locator('#elapsed')).toHaveText('1:13');
  await expect(page.locator('body')).not.toHaveClass(/is-playing/);
  await expect.poll(() => page.evaluate(() => window.awunApp?.state.restoredPlayback)).toBe(true);
  await page.locator('#playPause').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await page.locator('#closePlayer').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => localStorage.getItem('awun-playback-session-v1'))).toBeNull();
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

test('My Wave broadens an empty discovery search without repeating the playing title', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="soundcloud"]').first().locator('.play').click();
  const queries = [];
  const recommendation = { ...TRACKS.jamendo[0], id: 'jamendo_fresh-energy', title: 'Fresh Energy' };
  await page.route('**/api/v1/search', route => {
    const body = route.request().postDataJSON();
    queries.push(body.query);
    const tracks = body.query === 'workout instrumental' ? [recommendation] : [];
    return route.fulfill({ json: { query: body.query, tracks, total: tracks.length, searched_sources: body.sources, errors: {} } });
  });
  await page.locator('#flowButton').click();
  await page.locator('[data-flow-discovery="new"]').click();
  await page.locator('#flowMood').selectOption('energy');
  await page.locator('#flowActivity').selectOption('training');
  await page.locator('#flowLanguage').selectOption('instrumental');
  await page.locator('#flowEra').selectOption('fresh');
  await page.locator('#flowStart').click();

  await expect.poll(() => page.evaluate(() => window.awunApp.state.queue.some(track => track.id === 'jamendo_fresh-energy'))).toBe(true);
  expect(queries.slice(0, 2)).toEqual(['energetic instrumental', 'workout instrumental']);
  expect(queries.every(query => !query.toLowerCase().includes('midnight signal'))).toBe(true);
  await expect(page.locator('#message')).toContainText('МОЯ ВОЛНА запущена');
});

test('My Wave keeps playing local tracks when connected searches return no new music', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="soundcloud"]').first().locator('.play').click();
  await page.route('**/api/v1/search', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { query: body.query, tracks: [], total: 0, searched_sources: body.sources, errors: {} } });
  });
  await page.locator('#flowButton').click();
  await page.locator('#flowStart').click();

  await expect(page.locator('#message')).toContainText('Пока всё: новых треков не найдено');
  await expect(page.locator('body')).toHaveClass(/flow-active/);
  await expect(page.locator('#player')).not.toHaveClass(/player-empty/);
});

test('My Wave shows search progress, stops after empty sources, and retries on request', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  let releaseFirst;
  const firstSearch = new Promise(resolve => { releaseFirst = resolve; });
  let calls = 0, allowNewTracks = false;
  const recommendation = { ...TRACKS.jamendo[0], id: 'jamendo_wave-retry', title: 'Second Chance' };
  await page.route('**/api/v1/search', async route => {
    const body = route.request().postDataJSON();
    calls += 1;
    if (calls === 1) await firstSearch;
    const tracks = allowNewTracks ? [recommendation] : [];
    await route.fulfill({ json: { query: body.query, tracks, total: tracks.length, searched_sources: body.sources, errors: {} } });
  });
  await page.locator('#flowButton').click();
  await page.locator('#flowStart').click();
  await page.locator('#flowButton').click();
  await expect(page.locator('#flowBadge')).toHaveText('ИЩЕМ');
  await expect(page.locator('#flowBadge')).toBeVisible();
  await expect(page.locator('#sidebarWaveStatus')).toContainText('запрос 1 из');
  await expect(page.locator('#sidebarWaveStatus')).toBeVisible();
  await expect(page.locator('#flowStatus')).toContainText('запрос 1 из');
  releaseFirst();

  await expect(page.locator('#flowStatus')).toContainText('Пока всё: новых треков не найдено');
  await expect(page.locator('#flowBadge')).toHaveText('НЕТ НОВЫХ');
  await expect(page.locator('#sidebarWaveStatus')).toContainText('Пока всё');
  await expect(page.locator('#flowRetry')).toBeVisible();
  const exhaustedCalls = calls;
  await page.locator('#nextTrack').click();
  expect(calls).toBe(exhaustedCalls);
  allowNewTracks = true;
  await page.locator('#flowRetry').click();
  await expect(page.locator('#flowStatus')).toContainText('Найдено треков: 1');
  await expect(page.locator('#flowBadge')).toHaveText('ЭФИР');
  await expect(page.locator('#flowRetry')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.awunApp.state.queue.some(track => track.id === 'jamendo_wave-retry'))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#flowStatusCard')).toBeVisible();
  await expect(page.locator('#flowBadge')).toBeVisible();
  await expect(page.locator('#sidebarWaveStatus')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('My Wave distinguishes unavailable sources from an empty search', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.route('**/api/v1/search', route => route.fulfill({ status: 502, json: { detail: 'unavailable' } }));
  await page.locator('#flowButton').click();
  await page.locator('#flowStart').click();
  await page.locator('#flowButton').click();
  await expect(page.locator('#flowStatus')).toContainText('Источники не ответили');
  await expect(page.locator('#flowBadge')).toHaveText('ОШИБКА СЕТИ');
  await expect(page.locator('#flowRetry')).toBeVisible();
});

test('changing Wave settings replaces a pending search with the new choice', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  let releaseOld;
  const oldSearch = new Promise(resolve => { releaseOld = resolve; });
  const queries = [];
  const recommendation = { ...TRACKS.jamendo[0], id: 'jamendo_calm-choice', title: 'Calm Choice' };
  await page.route('**/api/v1/search', async route => {
    const body = route.request().postDataJSON();
    queries.push(body.query);
    if (queries.length === 1) await oldSearch;
    const tracks = body.query.includes('calm') ? [recommendation] : [];
    await route.fulfill({ json: { query: body.query, tracks, total: tracks.length, searched_sources: body.sources, errors: {} } });
  });
  try {
    await page.locator('#flowButton').click();
    await page.locator('#flowStart').click();
    await page.locator('#flowButton').click();
    await expect(page.locator('#flowStatus')).toContainText('запрос 1 из');
    await page.locator('#flowMood').selectOption('calm');
    await expect.poll(() => queries.some(query => query.includes('calm'))).toBe(true);
    await expect(page.locator('#flowStatus')).toContainText('Найдено треков: 1');
  } finally { releaseOld(); }
});

test('My Wave reports a finished search when no playable music exists', async ({ page }) => {
  await openAwun(page);
  await page.route('**/api/v1/search', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { query: body.query, tracks: [], total: 0, searched_sources: body.sources, errors: {} } });
  });
  await page.locator('#flowButton').click();
  await page.locator('#flowStart').click();
  await page.locator('#flowButton').click();
  await expect(page.locator('#flowStatus')).toContainText('не нашла доступных рекомендаций');
  await expect(page.locator('#flowBadge')).toHaveText('НЕ НАЙДЕНО');
  await expect(page.locator('body')).not.toHaveClass(/flow-active/);
});

test('the player shows loading and a clear unavailable-track result', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.evaluate(() => {
    const audio = document.getElementById('audio');
    audio.play = () => new Promise(resolve => { window.releaseAudio = resolve; });
  });
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await expect(page.locator('#playerStatus')).toContainText('Загружаем «Midnight Signal»');
  await expect(page.locator('#playerStatus')).toBeVisible();
  await page.evaluate(() => window.releaseAudio());
  await expect(page.locator('#playerStatus')).toBeHidden();

  await page.route('**/api/v1/search', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { query: body.query, tracks: [], total: 0, searched_sources: body.sources, errors: {} } });
  });
  await page.evaluate(() => { document.getElementById('audio').play = () => Promise.reject(new Error('audio unavailable')); });
  await page.locator('#trackList .track[data-source="audius"]').nth(1).locator('.play').click();
  await expect(page.locator('#playerStatus')).toContainText('Трек не найден или недоступен');
  await expect(page.locator('#playerStatus')).toHaveAttribute('data-tone', 'error');
  await page.evaluate(() => { document.getElementById('audio').play = () => Promise.resolve(); });
  await page.locator('#playPause').click();
  await expect(page.locator('#playerStatus')).toBeHidden();
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
  await page.locator('#playerSave').click();
  await expect(page.locator('#playerSave')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]').some(track => track.source === 'youtube'))).toBe(true);
  await page.locator('#playerSave').click();
  await expect(page.locator('#playerSave')).toHaveAttribute('aria-pressed', 'false');
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

test('desktop sidebar keeps upcoming and recent tracks within reach', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAwun(page);
  await expect(page.locator('#sidebarQueue')).toContainText('Включи трек');
  await expect(page.locator('#sidebarRecent')).toContainText('Здесь появятся');
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();

  await expect(page.locator('#sidebarQueue .sidebar-track').first()).toBeVisible();
  await expect(page.locator('#sidebarRecent .sidebar-track').first()).toContainText('Midnight Signal');
  const nextId = await page.evaluate(() => window.awunApp.state.queue[0].id);
  await page.locator('#sidebarQueue .sidebar-track').first().click();
  await expect.poll(() => page.evaluate(() => window.awunApp.state.active?.id)).toBe(nextId);
  await page.locator('#sidebarQueueAll').click();
  await expect(page.locator('#player')).toHaveClass(/queue-open/);
  await page.locator('#sidebarRecentAll').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#trackList .track')).toHaveCount(2);

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('.sidebar-listening')).toBeHidden();
});

test('backup import rejects invalid data, respects cancellation and restores after confirmation', async ({ page }) => {
  await openAwun(page);
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track').first().locator('.save').click();
  const original = await page.evaluate(() => localStorage.getItem('awun-library'));
  await page.locator('#themeButton').click();
  await page.locator('#diagnosticsButton').click();
  const fileInput = page.locator('#storageImportFile');
  await fileInput.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'AWUN', schema: 2, data: { 'awun-library': '[null]' } })) });
  await expect(page.locator('#diagnosticsToolsStatus')).toContainText('Не удалось восстановить');
  expect(await page.evaluate(() => localStorage.getItem('awun-library'))).toBe(original);

  const validFile = { name: 'AWUN-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'AWUN', schema: 2, data: { 'awun-library': JSON.stringify([TRACKS.audius[0]]) } })) };
  page.once('dialog', dialog => dialog.dismiss());
  await fileInput.setInputFiles(validFile);
  await expect(fileInput).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('awun-library'))).toBe(original);

  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), fileInput.setInputFiles(validFile)]);
  await expect(page.locator('#searchInput')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library')).map(track => track.id))).toEqual([TRACKS.audius[0].id]);
});

test('library transfer keeps only confident matches and exposes a final report', async ({ page }) => {
  await openAwun(page);
  await expect(page.locator('#welcomePanel')).toBeVisible();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importPanel')).toBeVisible();
  await page.locator('#importText').fill('AWUN Artist — Midnight Signal\nUnknown Artist — Missing Recording');
  await page.locator('#importSubmit').click();

  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
  await expect(page.locator('#importTotal')).toHaveText('2');
  await expect(page.locator('#importProcessed')).toHaveText('2');
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('1');
  await expect(page.locator('#importDownloadReport')).toBeVisible();
  await expect(page.locator('#importOpenLibrary')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]').map(track => track.title))).toEqual(['Midnight Signal']);
});

test('named playlists remain independent of favorites and filter without a network search', async ({ page }) => {
  await openAwun(page);
  await page.locator('#libraryButton').click();
  await page.locator('#playlistName').fill('Вечер');
  await page.locator('#playlistCreate button').click();
  await expect(page.locator('#playlistTabs [aria-pressed="true"]')).toContainText('Вечер');
  await page.locator('#searchNavButton').click();
  await searchFor(page, 'midnight signal');
  const track = page.locator('#trackList .track[data-source="audius"]').first();
  await track.locator('.track-queue-menu summary').click();
  await track.locator('.playlist-option').click();
  await track.locator('.save').click();
  await page.locator('#libraryButton').click();
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#libraryFilter').fill('not here');
  await expect(page.locator('#trackList .track')).toHaveCount(0);
  await expect(page.locator('#libraryEmptyState')).toContainText('По этому запросу');
  await page.locator('#libraryFilter').fill('AWUN Artist');
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#hubPlaylistCards .hub-playlist-card')).toContainText(['Вечер']);
  await page.locator('#hubPlaylistCards .hub-playlist-card').click();
  await expect(page.locator('#resultTitle')).toHaveText('Вечер');
  await page.locator('#searchNavButton').click();
  await page.locator('#libraryButton').click();
  await page.locator('#playlistTabs .playlist-tab').nth(1).click();
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#playlistTabs .playlist-tab').first().click();
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#playlistTabs .playlist-tab').nth(1).click();
  await page.locator('#trackList .track .save').click();
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#playlistTabs .playlist-tab').first().click();
  await expect(page.locator('#trackList .track')).toHaveCount(0);
});

test('transfer keeps a named playlist in source order across reload and backup', async ({ page }) => {
  await openAwun(page);
  await page.locator('#importButton').click();
  await page.locator('#importPlaylistName').fill('Мой экспорт');
  await page.locator('#importText').fill('AWUN Artist — Forest Echo\nAWUN Artist — Midnight Signal');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
  await expect(page.locator('#importAdded')).toHaveText('2');
  await page.locator('#importOpenLibrary').click();
  await expect(page.locator('#resultTitle')).toHaveText('Мой экспорт');
  await expect(page.locator('#trackList .track .name strong')).toHaveText(['Forest Echo', 'Midnight Signal']);
  const backup = await page.evaluate(() => JSON.parse(window.awunStorage.exportState()));
  expect(JSON.parse(backup.data['awun-playlists-v1'])[0].items).toHaveLength(2);
  await page.evaluate(async snapshot => {
    localStorage.removeItem('awun-playlists-v1');
    await window.awunStorage.importState(snapshot);
  }, backup);
  await page.reload();
  await page.locator('#libraryButton').click();
  await page.locator('#playlistTabs .playlist-tab').nth(1).click();
  await expect(page.locator('#trackList .track .name strong')).toHaveText(['Forest Echo', 'Midnight Signal']);
});

test('failed local writes leave no misleading favorites or playlists in memory', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'awun-playlists-v1' || key === 'awun-library') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await openAwun(page);
  await page.locator('#libraryButton').click();
  await page.locator('#playlistName').fill('Нельзя сохранить');
  await page.locator('#playlistCreate button').click();
  await expect(page.locator('#message')).toContainText('Не удалось сохранить');
  expect(await page.evaluate(() => window.awunApp.state.playlists)).toEqual([]);
  await expect(page.locator('#playlistTabs .playlist-tab')).toHaveCount(1);
  await page.locator('#searchNavButton').click();
  await searchFor(page, 'midnight signal');
  const save = page.locator('#trackList .track[data-source="audius"]').first().locator('.save');
  await save.click();
  await expect(page.locator('#message')).toContainText('Не удалось сохранить');
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.awunApp.state.saved)).toEqual([]);
});

test('playlist controls fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openAwun(page);
  await page.locator('#libraryButton').click();
  await expect(page.locator('#libraryFilter')).toBeVisible();
  await expect(page.locator('#playlistName')).toBeVisible();
  const bounds = await page.evaluate(() => [document.querySelector('#libraryFilter'),document.querySelector('#playlistName'),document.querySelector('#playlistCreate button')].map(node => {
    const rect = node.getBoundingClientRect();return [rect.left,rect.right];
  }));
  bounds.forEach(([left,right]) => { expect(left).toBeGreaterThanOrEqual(0);expect(right).toBeLessThanOrEqual(391); });
});

test('library transfer recognizes Russian CSV headers, quoted fields and semicolons', async ({ page }) => {
  await openAwun(page);
  await page.locator('#welcomeImport').click();
  await page.locator('#libraryFile').setInputFiles({
    name: 'collection.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Исполнитель;Название;Длительность\n"AWUN Artist";"Midnight Signal";03:34\n"Unknown; Artist";"Missing Recording";01:43'),
  });
  await expect(page.locator('#importTotal')).toHaveText('2');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('1');
});

test('oversized transfer reports every track instead of silently dropping the tail', async ({ page }) => {
  await openAwun(page);
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill(Array.from({ length: 1001 }, (_, index) => `Artist ${index} — Track ${index}`).join('\n'));
  await expect(page.locator('#importTotal')).toHaveText('1001');
  await expect(page.locator('#importStatus')).toContainText('Найдено 1001 уникальных треков');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importStatus')).toContainText('раздели файл на части');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]'))).toEqual([]);
});

test('library transfer groups copied playlist rows instead of matching metadata lines', async ({ page }) => {
  await openAwun(page);
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill([
    'Midnight Signal',
    'AWUN Artist',
    '02:40',
    '',
    'Missing Recording',
    'Unknown Artist',
    'Admony',
    '01:43',
  ].join('\n'));
  await page.locator('#importSubmit').click();

  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
  await expect(page.locator('#importTotal')).toHaveText('2');
  await expect(page.locator('#importProcessed')).toHaveText('2');
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]').map(track => track.title))).toEqual(['Midnight Signal']);
});

test('library transfer matches catalog decorations and keeps imported duration', async ({ page }) => {
  await openAwun(page);
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill([
    'Midnight Signal (Official Audio)',
    'AWUN Artist feat. Guest',
    '03:34',
  ].join('\n'));
  await page.locator('#importSubmit').click();

  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('0');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]')[0]?.title)).toBe('Midnight Signal');
});

test('uncertain library matches wait for a manual candidate choice', async ({ page }) => {
  await openAwun(page);
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill([
    'AWUN Artist — Midnight Signal Extended Journey',
    'AWUN Artist — Midnight Signal Extended Story',
  ].join('\n'));
  await page.locator('#importSubmit').click();

  await expect(page.locator('#importReviewCount')).toHaveText('2');
  await expect(page.locator('#importReviewPanel')).toBeVisible();
  await expect(page.locator('#importReviewCandidates li')).toHaveCount(3);
  await page.locator('#importReviewSearchInput').fill('AWUN Artist Midnight Signal');
  await page.locator('#importReviewSearchButton').click();
  await expect(page.locator('#importReviewCandidates li')).toHaveCount(3);
  await page.locator('#importReviewCandidates li').first().locator('button').click();
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await page.locator('#importReviewSkip').click();
  await expect(page.locator('#importReviewCount')).toHaveText('0');
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('1');
  await expect(page.locator('#importReviewPanel')).toBeHidden();
});

test('unfinished transfer resumes after reload and does not duplicate a saved recording', async ({ page }) => {
  await openAwun(page);
  await page.evaluate(() => localStorage.setItem('songvale-import-session-v1',JSON.stringify({
    version:1,total:1,processed:0,added:0,review:[],missed:[],
    pendingTracks:[{id:'ym_resume',title:'Midnight Signal',artist:'AWUN Artist',duration:214,source:'yandex_music',stream_url:'',catalog_links:{}}],
    pending:1,running:false,stopped:true,titleKey:'transferStopped',statusKey:'importStopped',statusValues:{processed:0,total:1},
  })));
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importResume')).toBeVisible();
  await page.locator('#importResume').click();
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importResume')).toBeHidden();

  await page.locator('#importText').fill('AWUN Artist — Midnight Signal');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importAdded')).toHaveText('0');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]').length)).toBe(1);
});

test('missed tracks can be retried without reprocessing successful matches', async ({ page }) => {
  await openAwun(page);
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('Unknown Artist — Missing Recording');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importMissed')).toHaveText('1');
  await expect(page.locator('#importRetryMissed')).toBeVisible();
  await page.locator('#importRetryMissed').click();
  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
  await expect(page.locator('#importTotal')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('awun-library') || '[]').length)).toBe(0);
});

test('sound profile persists and direct playback activates the audio engine', async ({ page }) => {
  await openAwun(page);
  await page.locator('#themeButton').click();
  await page.locator('[data-audio-profile="warm"]').click();
  await expect(page.locator('[data-audio-profile="warm"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('songvale-audio-v1')))).toEqual({ profile: 'warm', enabled: true });
  await page.locator('#themeClose').click();
  await searchFor(page, 'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await page.locator('#themeButton').click();
  await expect(page.locator('#soundEngineStatus')).toHaveText(/текущему прямому потоку|не предоставляет доступ/);
  await page.locator('#soundEngineToggle').click();
  await expect(page.locator('#soundEngineToggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('songvale-audio-v1')))).toEqual({ profile: 'warm', enabled: false });
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
      window.scrollTo({ top: 0, behavior: 'instant' });
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
        player: bounds('#player'), controls: ['#nowTitle', '#playPause', '#waveProgress', '#playerSave', '#queueToggle', '#muteButton', '#volume'].map(bounds) };
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
    // Chromium patch versions vary slightly in font rasterization across CI and local builds.
    await expect(page).toHaveScreenshot(`${viewport.name}.png`, { maxDiffPixelRatio: 0.02 });
  });
}
