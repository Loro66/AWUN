const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { openAwun, TRACKS } = require('./fixtures');

function searchResponse(body, tracks = [], errors = {}) {
  return { query:body.query, tracks, total:tracks.length, searched_sources:body.sources, query_variants:[body.query], errors, elapsed_ms:20 };
}

const indila = { ...TRACKS.youtube[0], id:'yt_indila-test', artist:'Indila', title:'Indila - Dernière Danse (Clip Officiel)', duration:215 };

async function restoreMixedImport(page) {
  await openAwun(page);
  await page.evaluate(({ saved,candidate })=>{
    const imported=title=>({ artist:'AWUN Artist',title,duration:214,source:'yandex_music',stream_url:'',catalog_links:{} });
    localStorage.setItem('awun-library',JSON.stringify([saved]));
    localStorage.setItem('awun-playlists-v1',JSON.stringify([{ id:'mixed-import',name:'Перенос',items:[{ track:saved,position:0 }],importKeys:[] }]));
    localStorage.setItem('songvale-import-session-v1',JSON.stringify({ version:1,playlistId:'mixed-import',playlistName:'Перенос',total:5,processed:4,added:1,
      review:[{ imported:imported('Choose Recording'),candidates:[{ candidate,confidence:.78 }] }],
      missed:[imported('Missing Recording')],failed:[{ ...imported('Failed Recording'),source_errors:{ youtube:'Unavailable' } }],
      pendingTracks:[imported('Midnight Signal')],pending:1,running:false,stopped:true,titleKey:'transferStopped' }));
  },{ saved:TRACKS.jamendo[0],candidate:{ ...TRACKS.youtube[0],id:'yt_choose',title:'Choose Recording' } });
  await page.reload();
  await page.locator('#welcomeImport').click();
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON();
    const title=body.query.includes('Missing Recording')?'Missing Recording':body.query.includes('Failed Recording')?'Failed Recording':'Midnight Signal';
    const candidate={ ...TRACKS.youtube[0],id:`yt_${title.replaceAll(' ','_')}`,title };
    return route.fulfill({ json:searchResponse(body,[candidate]) });
  });
}

test('resume and retry preserve every unresolved track and cumulative import progress',async({ page })=>{
  await restoreMixedImport(page);
  await page.locator('#importResume').click();
  await expect(page.locator('#importProcessed')).toHaveText('5');
  await expect(page.locator('#importTotal')).toHaveText('5');
  await expect(page.locator('#importAdded')).toHaveText('2');
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('1');
  await expect(page.locator('#importFailed')).toHaveText('1');
  await page.reload();
  await page.locator('#welcomeImport').click();
  await page.locator('#importRetryMissed').click();
  await expect(page.locator('#importAdded')).toHaveText('4');
  await expect(page.locator('#importProcessed')).toHaveText('5');
  await expect(page.locator('#importTotal')).toHaveText('5');
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('0');
  await expect(page.locator('#importFailed')).toHaveText('0');
  await page.locator('#importReviewCandidates button').first().click();
  await expect(page.locator('#importAdded')).toHaveText('5');
  await expect(page.locator('#importReviewCount')).toHaveText('0');
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importReviewCount')).toHaveText('0');
  expect(await page.evaluate(()=>window.awunApp.state.playlists.find(list=>list.id==='mixed-import').items.length)).toBe(5);
});

test('retrying failed searches keeps unfinished tracks available to resume',async({ page })=>{
  await restoreMixedImport(page);
  await page.locator('#importRetryMissed').click();
  await expect(page.locator('#importAdded')).toHaveText('3');
  await expect(page.locator('#importProcessed')).toHaveText('4');
  await expect(page.locator('#importTotal')).toHaveText('5');
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await expect(page.locator('#importResume')).toBeVisible();
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importResume')).toBeVisible();
  await page.locator('#importResume').click();
  await expect(page.locator('#importAdded')).toHaveText('4');
  await expect(page.locator('#importProcessed')).toHaveText('5');
  await expect(page.locator('#importResume')).toBeHidden();
  await expect(page.locator('#importReviewCount')).toHaveText('1');
});

test('Yandex import saves the exact popular recording without waiting for another source', async ({ page }) => {
  await openAwun(page);
  const searched=[];
  await page.route('**/api/v1/search', async route => {
    const body=route.request().postDataJSON();
    searched.push(body.sources);
    await route.fulfill({ json:searchResponse(body,body.sources.includes('youtube')?[indila]:[],{ soundcloud:'Source timed out' }) });
  });
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('Indila — Dernière danse');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('0');
  await expect(page.locator('#importFailed')).toHaveText('0');
  expect(searched).toEqual([['youtube']]);
});

test('import accepts a provider response after the old 14 second deadline', async ({ page }) => {
  await openAwun(page);
  await page.route('**/api/v1/search', async route => {
    const body=route.request().postDataJSON();
    await new Promise(resolve=>setTimeout(resolve,15000));
    await route.fulfill({ json:searchResponse(body,[indila]) });
  });
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('Indila — Dernière danse');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importAdded')).toHaveText('1',{ timeout:20000 });
  await expect(page.locator('#importFailed')).toHaveText('0');
});

test('failed provider checks remain retryable and are not reported as absent music', async ({ page }) => {
  await openAwun(page);
  let recovered=false;
  await page.route('**/api/v1/search', async route => {
    const body=route.request().postDataJSON();
    const tracks=recovered&&body.sources.includes('youtube')?[indila]:[];
    await route.fulfill({ json:searchResponse(body,tracks,recovered?{}:{ [body.sources[0]]:'Provider unavailable' }) });
  });
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('Indila — Dernière danse');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importFailed')).toHaveText('1');
  await expect(page.locator('#importMissed')).toHaveText('0');
  await expect(page.locator('#importReportTitle')).toHaveText('Нужен повтор поиска');
  await expect(page.locator('#importRetryMissed')).toBeVisible();
  const download=page.waitForEvent('download');
  await page.locator('#importDownloadReport').click();
  const file=await download;
  const report=JSON.parse(readFileSync(await file.path(),'utf8'));
  expect(report.not_found).toEqual([]);
  expect(report.search_failed[0]).toMatchObject({ artist:'Indila',title:'Dernière danse',source_errors:{ youtube:'Provider unavailable',soundcloud:'Provider unavailable' } });
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importFailed')).toHaveText('1');
  recovered=true;
  await page.locator('#importRetryMissed').click();
  await expect(page.locator('#importAdded')).toHaveText('1');
  await expect(page.locator('#importFailed')).toHaveText('0');
});

test('manual review cannot finish or overwrite an import that is still running', async ({ page }) => {
  await openAwun(page);
  let release;
  const held=new Promise(resolve=>{release=resolve});
  await page.route('**/api/v1/search', async route => {
    const body=route.request().postDataJSON();
    const slow=body.query.includes('Forest Echo');
    if(slow)await held;
    else if(body.sources[0]==='youtube')await new Promise(resolve=>setTimeout(resolve,1100));
    const tracks=slow?[TRACKS.audius[1]]:TRACKS[body.sources[0]]||[];
    await route.fulfill({ json:searchResponse(body,tracks) });
  });
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('AWUN Artist — Midnight Signal Extended Journey\nAWUN Artist — Forest Echo');
  await page.locator('#importSubmit').click();
  try {
    await expect(page.locator('#importReviewCount')).toHaveText('1');
    await expect(page.locator('#importProcessed')).toHaveText('1');
    await expect(page.locator('#importReportTitle')).toHaveText('Переносим медиатеку');
    await expect(page.locator('#importReviewPanel')).toBeHidden();
    await expect(page.locator('#importCancel')).toBeVisible();
  } finally { release() }
  await expect(page.locator('#importProcessed')).toHaveText('2');
  await expect(page.locator('#importReviewPanel')).toBeVisible();
  await page.locator('#importReviewCandidates button').first().click();
  await expect(page.locator('#importReviewCount')).toHaveText('0');
  await expect(page.locator('#importReportTitle')).toHaveText('Перенос завершён');
});

test('import reviews repeated song names once while keeping a slowed version separate', async ({ page }) => {
  await openAwun(page);
  await page.route('**/api/v1/search', async route => {
    const body=route.request().postDataJSON();
    const tracks=body.sources[0]==='youtube'?[TRACKS.youtube[0],{ ...TRACKS.youtube[0],id:'yt_slowed',title:'Midnight (slowed)' }]:[];
    await route.fulfill({ json:searchResponse(body,tracks) });
  });
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('AWUN Artist — Midnight Signal Extended Journey\nawun artist — Midnight Signal Extended Journey\nAWUN Artist — Midnight-Signal Extended Journey\nAWUN Artist — Midnight Signal Extended Journey (slowed)');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importProcessed')).toHaveText('2');
  await expect(page.locator('#importReviewCount')).toHaveText('2');
  await page.locator('#importReviewCandidates button').first().click();
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await expect(page.locator('#importReviewTitle')).toContainText('(slowed)');
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await expect(page.locator('#importReviewTitle')).toContainText('(slowed)');
  await page.locator('#importReviewCandidates button').first().click();
  await expect(page.locator('#importReviewCount')).toHaveText('0');
});

test('an old saved review queue cannot ask five times for the same recording', async ({ page }) => {
  await openAwun(page);
  await page.evaluate(candidate=>{
    const item={ imported:{ artist:'VXLIAGE',title:'Bulletproof' },candidates:[{ candidate,confidence:.78 }] };
    localStorage.setItem('songvale-import-session-v1',JSON.stringify({ version:1,total:1,processed:1,added:0,review:Array.from({ length:5 },()=>item),missed:[],pendingTracks:[],running:false,titleKey:'transferComplete' }));
  },{ ...TRACKS.youtube[0],id:'yt_bulletproof',artist:'VXLIAGE',title:'Bulletproof' });
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importReviewCount')).toHaveText('1');
  await page.locator('#importReviewCandidates button').first().click();
  await expect(page.locator('#importReviewCount')).toHaveText('0');
  await expect(page.locator('#importReviewPanel')).toBeHidden();
  await page.reload();
  await page.locator('#welcomeImport').click();
  await expect(page.locator('#importReviewCount')).toHaveText('0');
  await expect(page.locator('#importReviewPanel')).toBeHidden();
});

test('desktop import gives its remote fallback the same provider response budget',async({ page })=>{
  await openAwun(page);
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON();
    return route.fulfill({ json:searchResponse(body,[],{ youtube:'Local provider unavailable' }) });
  });
  await page.route('https://fallback.example/api/v1/search',async route=>{
    const body=route.request().postDataJSON();
    await new Promise(resolve=>setTimeout(resolve,15000));
    await route.fulfill({ json:searchResponse(body,[indila]) });
  });
  await page.goto('/?lang=ru&platform=desktop&fallback_api=https%3A%2F%2Ffallback.example');
  await expect(page.locator('#searchInput')).toBeVisible();
  await page.locator('#welcomeImport').click();
  await page.locator('#importText').fill('Indila — Dernière danse');
  await page.locator('#importSubmit').click();
  await expect(page.locator('#importAdded')).toHaveText('1',{ timeout:20000 });
  await expect(page.locator('#importFailed')).toHaveText('0');
});
