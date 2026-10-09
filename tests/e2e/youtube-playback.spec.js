const { test,expect }=require('@playwright/test');
const { openAwun,searchFor,TRACKS }=require('./fixtures');

async function onlyYouTube(page){
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON(),tracks=body.sources.includes('youtube')?[TRACKS.youtube[0]]:[];
    return route.fulfill({json:{query:body.query,tracks,total:tracks.length,searched_sources:body.sources,errors:{}}});
  });
}
async function startYouTube(page){
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="youtube"]').first().locator('.play').click();
}

test('old connection errors no longer hide working YouTube search results',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('awun-youtube-failures-v1',JSON.stringify({
    'working-video':{at:Date.parse('2026-09-04T12:40:16.708Z'),code:'153'},
    'blocked-video':{at:Date.parse('2026-09-04T12:40:16.708Z'),code:'150'},
  })));
  await openAwun(page);
  await searchFor(page,'midnight signal');
  await expect(page.locator('#trackList .track[data-source="youtube"]')).toHaveCount(1);
  await page.locator('#trackList .track[data-source="youtube"] .play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  expect(await page.evaluate(()=>window.awunApp.state.active.id)).toBe(TRACKS.youtube[0].id);
});

test('client identity failure skips futile YouTube retries and switches sources',async({page})=>{
  await openAwun(page);
  await page.evaluate(()=>{
    const Player=window.YT.Player;window.youtubeAttempts=[];
    window.YT.Player=class extends Player{playVideo(){window.youtubeAttempts.push(this.videoId);queueMicrotask(()=>this.options.events.onError({data:153}))}};
  });
  await startYouTube(page);
  await expect(page.locator('#nowSource')).toHaveText('SoundCloud');
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  expect(await page.evaluate(()=>window.youtubeAttempts)).toHaveLength(1);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('awun-youtube-failures-v1')||'{}')['working-video'])).toBeUndefined();
  await searchFor(page,'midnight signal');
  await expect(page.locator('#trackList .track[data-source="youtube"]')).toHaveCount(1);
});

test('YouTube failure shows its code and a link to the exact original video',async({page})=>{
  await openAwun(page);await onlyYouTube(page);
  await page.evaluate(()=>{
    const Player=window.YT.Player;
    window.YT.Player=class extends Player{playVideo(){queueMicrotask(()=>this.options.events.onError({data:153}))}};
  });
  await startYouTube(page);
  await expect(page.locator('#playerStatus')).toContainText('код 153');
  await expect(page.locator('#youtubeExternal')).toBeVisible();
  await expect(page.locator('#youtubeExternal')).toHaveAttribute('href',TRACKS.youtube[0].stream_url);
  await expect(page.locator('#youtubeExternal')).toHaveAttribute('rel','noopener');
});

test('autoplay blocking preserves the player for a manual start',async({page})=>{
  await openAwun(page);await onlyYouTube(page);
  await page.evaluate(()=>{
    const Player=window.YT.Player;
    window.YT.Player=class extends Player{playVideo(){if(window.manualYoutubeStart)super.playVideo();else queueMicrotask(()=>this.options.events.onAutoplayBlocked())}};
  });
  await page.clock.install();
  await startYouTube(page);await page.clock.runFor(10);
  await expect(page.locator('#playerStatus')).toContainText('Автозапуск запрещён');
  await expect(page.locator('#youtubeDock')).toBeVisible();
  await expect(page.locator('#playerStatus')).toHaveAttribute('data-tone','notice');
  await page.clock.runFor(20000);
  expect(await page.evaluate(()=>window.awunApp.state.youtube.destroyed)).toBeUndefined();
  expect(await page.evaluate(()=>window.awunApp.state.failedTrackIds.size)).toBe(0);
  await page.evaluate(()=>{window.manualYoutubeStart=true});
  await page.locator('#playPause').click();await page.clock.runFor(10);
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#playerStatus')).toBeHidden();
});

test('failed YouTube API loading can retry without restarting the application',async({page})=>{
  await openAwun(page);await onlyYouTube(page);
  await page.evaluate(()=>{window.testYoutubeApi=window.YT;delete window.YT});
  let attempts=0;
  await page.route('https://www.youtube.com/iframe_api',route=>++attempts===1?route.abort():route.fulfill({contentType:'text/javascript',body:'window.YT=window.testYoutubeApi;window.onYouTubeIframeAPIReady()'}));
  await startYouTube(page);
  await expect(page.locator('#playerStatus')).toContainText('api-load');
  expect(await page.evaluate(()=>window.awunApp.state.youtubeApi)).toBeNull();
  await page.locator('#playPause').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  expect(attempts).toBe(2);
  await expect(page.locator('#playerStatus')).toBeHidden();
});

test('an iframe that never becomes ready times out instead of hanging forever',async({page})=>{
  await openAwun(page);await onlyYouTube(page);
  await page.evaluate(()=>{
    window.YT.Player=class{getPlayerState(){return 5}destroy(){this.destroyed=true}};
  });
  await page.clock.install();
  await startYouTube(page);await page.clock.runFor(16000);
  await expect(page.locator('#playerStatus')).toContainText('timeout');
  await expect(page.locator('#youtubeExternal')).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('awun-youtube-failures-v1')||'{}')['working-video'])).toBeUndefined();
});
