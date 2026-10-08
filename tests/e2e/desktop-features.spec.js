const { test, expect } = require('@playwright/test');
const { openAwun, searchFor, TRACKS, installApiMocks, installMediaMocks } = require('./fixtures');
const { mkdirSync } = require('node:fs');

async function openDesktop(page, options = {}) {
  await installMediaMocks(page);
  await installApiMocks(page);
  await page.addInitScript(options => {
    window.desktopCalls = [];
    let mini = false, hotkeys = true, closeToTray = true;
    window.pywebview = { api: {
      load_state: async () => '{}',
      save_state: async value => { window.desktopCalls.push(['save', JSON.parse(value)]); return true; },
      desktop_status: async () => ({supported:true,tray:true,mini,hotkeys,close_to_tray:closeToTray,shortcuts:[{keys:'Ctrl+Alt+Space',active:true}]}),
      desktop_mini: async (enabled,video) => { mini=enabled; window.desktopCalls.push(['mini',enabled,video]); return true; },
      desktop_preferences: async (keys,tray) => { hotkeys=keys; closeToTray=tray; return true; },
      desktop_command: async action => { window.desktopCalls.push(['command',action]); return true; },
      desktop_update: async () => true,
      desktop_update_status: async () => ({stage:options.updateFailure?'error':'ready',progress:100}),
      desktop_update_install: async () => { window.desktopCalls.push(['install']); return true; },
    }};
  }, options);
  await page.goto('/?desktop=1&lang=ru');
  await expect(page.locator('#desktopMini')).toBeAttached();
}

test('mini mode preserves active playback/position and restores the full interface', async ({ page }) => {
  await openDesktop(page);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await page.locator('#audio').evaluate(audio => { audio.currentTime=41; });
  const generation = await page.evaluate(() => window.awunApp.state.playbackGeneration);
  await page.locator('#desktopMini').click();
  await expect(page.locator('body')).toHaveClass(/desktop-mini/);
  await expect(page.locator('#desktopMiniRestore')).toBeVisible();
  await expect(page.locator('#playPause')).toBeVisible();
  await expect(page.locator('#elapsed')).toHaveText('0:41');
  expect(await page.evaluate(() => window.awunApp.state.playbackGeneration)).toBe(generation);
  await page.locator('#playPause').click();
  await expect(page.locator('body')).not.toHaveClass(/is-playing/);
  await page.locator('#desktopMiniRestore').click();
  await expect(page.locator('body')).not.toHaveClass(/desktop-mini/);
  await expect(page.locator('#searchInput')).toBeVisible();
});

test('native commands use the existing player and volume is bounded', async ({ page }) => {
  await openDesktop(page);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('songvale:desktop-command',{detail:{action:'play_pause'}})));
  await expect(page.locator('body')).not.toHaveClass(/is-playing/);
  await page.evaluate(() => { for(let i=0;i<30;i++)window.dispatchEvent(new CustomEvent('songvale:desktop-command',{detail:{action:'volume_up'}})); });
  await expect(page.locator('#volume')).toHaveValue('100');
  await page.locator('#desktopTray').click();
  expect(await page.evaluate(() => window.desktopCalls.some(call => call[0]==='command'&&call[1]==='hide'))).toBe(true);
});

test('YouTube remains visible with a 200px player in compact mode', async ({ page }) => {
  await openDesktop(page);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="youtube"]').first().locator('.play').click();
  await page.locator('#desktopMini').click();
  await page.setViewportSize({width:460,height:505});
  await expect(page.locator('#youtubeDock')).toBeVisible();
  expect((await page.locator('#youtubePlayer').boundingBox()).height).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => window.desktopCalls.some(call=>call[0]==='mini'&&call[2]===true))).toBe(true);
});

test('one-click update saves current state before launching the verified installer', async ({ page }) => {
  await openDesktop(page);
  await page.locator('#themeButton').click();
  await page.locator('#desktopUpdate').click();
  await expect(page.locator('#desktopUpdateStatus')).toContainText('перезапустится');
  const calls = await page.evaluate(() => window.desktopCalls);
  expect(calls.findIndex(call=>call[0]==='save')).toBeLessThan(calls.findIndex(call=>call[0]==='install'));
});

test('update failure keeps the app open and enables retry', async ({ page }) => {
  await openDesktop(page,{updateFailure:true});
  await page.locator('#themeButton').click();
  await page.locator('#desktopUpdate').click();
  await expect(page.locator('#desktopUpdateStatus')).toContainText('Текущая версия остаётся');
  await expect(page.locator('#desktopUpdate')).toBeEnabled();
  expect(await page.evaluate(() => window.desktopCalls.some(call=>call[0]==='install'))).toBe(false);
});

test('smart playlists derive from additions and qualified history, persist and filter', async ({ page }) => {
  await openAwun(page);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.save').click();
  await page.locator('#libraryButton').click();
  await page.locator('[data-smart-playlist="recent"]').click();
  await expect(page.locator('#resultTitle')).toHaveText('Недавно добавленные');
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('#libraryFilter').fill('no such track');
  await expect(page.locator('#trackList .track')).toHaveCount(0);
  await page.locator('#libraryFilter').fill('');
  await page.reload();
  await page.locator('#libraryButton').click();
  await page.locator('[data-smart-playlist="recent"]').click();
  await expect(page.locator('#trackList .track')).toHaveCount(1);
  await page.locator('[data-smart-playlist="frequent"]').click();
  await expect(page.locator('#trackList .track')).toHaveCount(0);
  await page.evaluate(() => {
    const app=window.awunApp;
    const track={...app.state.saved[0],duration:2};
    app.playTrack(track);
  });
  await expect(page.locator('#trackList .track')).toHaveCount(1,{timeout:5000});
  await expect(page.locator('#playlistActions')).toBeHidden();
});

test('smart playlists do not reuse another account listening history', async ({ page }) => {
  await openAwun(page);
  await page.evaluate(track => {
    localStorage.setItem('awun-library',JSON.stringify([track]));
    localStorage.setItem('awun-listening-v1',JSON.stringify({owner:'another-account',tracks:{[`${track.source}:${track.id}`]:{plays:100,last_played:Date.now(),added_at:Date.now()}}}));
  }, TRACKS.audius[0]);
  await page.reload();
  await page.locator('#libraryButton').click();
  await page.locator('[data-smart-playlist="frequent"]').click();
  await expect(page.locator('#trackList .track')).toHaveCount(0);
});

test('new controls fit desktop and phone layouts, with compact audio/video QA images', async ({ page }) => {
  mkdirSync('test-results/feature-qa',{recursive:true});
  await openAwun(page);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.save').click();
  await page.locator('#libraryButton').click();
  for(const width of [1920,1280,1000,390]) {
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#smartPlaylistTabs')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:`test-results/feature-qa/library-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1280,height:900});
  await openDesktop(page);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="audius"]').first().locator('.play').click();
  await page.screenshot({path:'test-results/feature-qa/desktop-controls.png'});
  await page.locator('#desktopMini').click();
  await page.setViewportSize({width:460,height:265});
  await expect(page.locator('#muteButton')).toBeVisible();
  for(const id of ['desktopMiniRestore','playPause','volume']) {
    const box=await page.locator(`#${id}`).boundingBox();
    expect(box.y+box.height).toBeLessThanOrEqual(265);
  }
  await page.screenshot({path:'test-results/feature-qa/mini-audio.png'});
  await page.locator('#desktopMiniRestore').click();
  await page.setViewportSize({width:1280,height:900});
  await page.locator('#themeButton').click();
  await page.screenshot({path:'test-results/feature-qa/windows-settings.png'});
});
