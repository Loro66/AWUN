const {test,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const {installMediaMocks,installApiMocks,openAwun,searchFor,TRACKS}=require('./fixtures');
const base={...TRACKS.audius[0],duration:214},youtube={...TRACKS.youtube[0],duration:215},soundcloud={...TRACKS.soundcloud[0],duration:214};
const another={...base,id:'audius_forest',title:'Forest Echo',stream_url:base.stream_url+'?forest'};
function wave(seconds=3,frequency=180){const rate=8000,size=Math.round(rate*seconds)*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);for(let i=0;i<size/2;i++)b.writeInt16LE(Math.round(Math.sin(i/rate*frequency*2*Math.PI)*4000),44+i*2);return b}
async function setup(page,{tracks=[base,youtube,soundcloud,another],real=false,clock=false}={}){
  if(!real)await installMediaMocks(page);await installApiMocks(page);
  await page.route('**/api/v1/search',route=>{const body=route.request().postDataJSON(),items=tracks.filter(track=>body.sources.includes(track.source));return route.fulfill({json:{tracks:items,total:items.length,searched_sources:body.sources,query:body.query,errors:{},elapsed_ms:1}})});
  if(clock)await page.clock.install();await page.goto('/?lang=ru');await page.evaluate(()=>window.SongvaleOffline.ready);
}
async function search(page){await page.locator('#searchInput').fill('Midnight Signal');await page.locator('#searchForm').evaluate(form=>form.requestSubmit());await expect.poll(()=>page.evaluate(()=>!window.awunApp.state.controller)).toBe(true)}

test('one recording card keeps all sources while remixes and covers remain separate',async({page})=>{
  await setup(page,{tracks:[base,youtube,soundcloud,{...base,id:'remix',title:'Midnight Signal (Club Remix)'},{...base,id:'cover',title:'Midnight Signal (Cover)'}]});await search(page);
  await expect(page.locator('#trackList .track')).toHaveCount(3);
  const grouped=page.locator('#trackList .track').filter({has:page.locator('.recording-sources')});await expect(grouped).toHaveCount(1);await grouped.locator('.recording-sources summary').click();
  await expect(grouped.locator('[data-variant-source]')).toHaveCount(3);await grouped.locator('[data-variant-source="soundcloud"]').click();
  await expect.poll(()=>page.evaluate(()=>window.awunApp.state.active?.source)).toBe('soundcloud');
  await page.locator('#playerSave').click();await page.reload();await search(page);
  const row=page.locator('#trackList .track').filter({has:page.locator('.recording-sources')});await row.locator('.play').click();
  await expect.poll(()=>page.evaluate(()=>window.awunApp.state.isPlaying&&window.awunApp.state.active?.source)).toBe('soundcloud');
  await page.locator('#libraryButton').click();await expect(page.locator('#trackList .track')).toHaveCount(1);
});

test('a source change retains position, the shared like and the listening session',async({page})=>{
  await setup(page);await search(page);const row=page.locator('#trackList .track').filter({has:page.locator('.recording-sources')});await row.locator('.save').click();await row.locator('.play').click();
  await page.evaluate(()=>document.querySelector('#audio').currentTime=37);
  await row.locator('.recording-sources summary').click();await row.locator('[data-variant-source="youtube"]').click();
  await expect.poll(()=>page.evaluate(()=>window.awunApp.state.isPlaying&&window.awunApp.state.active?.source)).toBe('youtube');
  expect(await page.evaluate(()=>window.awunApp.state.youtube.getCurrentTime())).toBe(37);await expect(page.locator('#playerSave')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.awunApp.state.saved.length)).toBe(1);
});

test('a known alternative recovers before a new search and becomes the remembered source',async({page})=>{
  await setup(page);await search(page);await page.locator('#trackList .recording-sources').first().evaluate(details=>details.open=true);
  await page.locator('[data-variant-source="soundcloud"]').first().click();await expect.poll(()=>page.evaluate(()=>window.awunApp.state.isPlaying)).toBe(true);
  let searches=0;await page.route('**/api/v1/search',route=>{searches++;return route.abort()});
  await page.evaluate(()=>document.querySelector('#audio').dispatchEvent(new Event('error')));
  await expect.poll(()=>page.evaluate(()=>window.awunApp.state.isPlaying&&window.awunApp.state.active?.source)).toBe('audius');expect(searches).toBe(0);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('songvale-source-preferences-v1'))[0].source)).toBe('audius');
});

test('preparing the next direct track keeps the current media source intact',async({page})=>{
  await setup(page,{tracks:[base,another]});await search(page);await page.locator('#trackList .track').first().locator('.play').click();
  await expect.poll(()=>page.evaluate(()=>window.SongvaleContinuous.state().status)).toBe('ready');
  const before=await page.evaluate(()=>document.querySelector('#audio').src);await page.locator('#nextTrack').click();await expect(page.locator('#nowTitle')).toHaveText('Forest Echo');
  expect(await page.evaluate(()=>document.querySelector('#audio').src)).not.toBe(before);await expect.poll(()=>page.evaluate(()=>window.awunApp.state.isPlaying)).toBe(true);
});

test('changing the queue cancels the stale preparation and plays the new next track',async({page})=>{
  const third={...another,id:'audius_third',title:'Third Recording',stream_url:another.stream_url+'?third'};await setup(page,{tracks:[base,another,third]});await search(page);await page.locator('#trackList .track').first().locator('.play').click();
  await page.evaluate(t=>window.awunApp.replaceQueue([t],'manual'),third);await expect.poll(()=>page.evaluate(()=>window.SongvaleContinuous.state().track?.id)).toBe(third.id);
  await expect.poll(()=>page.evaluate(()=>window.SongvaleContinuous.state().status)).toBe('ready');await page.locator('#nextTrack').click();await expect(page.locator('#nowTitle')).toHaveText(third.title);
});

test('wave dislike can be reversed and cannot return as another provider copy',async({page})=>{
  await setup(page);await page.evaluate(t=>window.awunApp.playTrack(t,{forcedSource:true}),base);await page.locator('#flowButton').click();await page.locator('#flowStart').click();await page.locator('#flowDislike').click();
  expect(await page.evaluate(t=>window.SongvaleFlow.rankCandidates([t]).length,youtube)).toBe(0);
  await page.evaluate(t=>window.awunApp.playTrack(t,{forcedSource:true}),base);await page.locator('#flowLike').click();expect(await page.evaluate(t=>window.SongvaleFlow.reaction(t),youtube)).toBe('like');
  const old={...base,id:'old_recording',title:'An Old Recording'},copy={...old,id:'yt_old',source:'youtube'};
  await page.evaluate(t=>window.awunApp.playTrack(t,{forcedSource:true}),old);
  expect(await page.evaluate(t=>window.SongvaleFlow.rankCandidates([t]).length,copy)).toBe(0);
});

test('seeking near the end does not create positive wave listening signals',async({page})=>{
  await setup(page,{clock:true});await page.evaluate(t=>window.awunApp.playTrack(t),base);await page.evaluate(()=>document.querySelector('#audio').currentTime=210);await page.clock.runFor(2000);
  expect(await page.evaluate(()=>window.SongvaleFlow.profile.signals.filter(s=>['complete','listen30'].includes(s.type)).length)).toBe(0);
});

test('real device audio is prepared separately and advances automatically through a crossfade',async({page})=>{
  await setup(page,{real:true,tracks:[]});await page.locator('#localAudioInput').setInputFiles([{name:'One.wav',mimeType:'audio/wav',buffer:wave(5,180)},{name:'Two.wav',mimeType:'audio/wav',buffer:wave(5,260)}]);
  await expect(page.locator('#collectionStatus')).toContainText('Добавлено: 2');
  await page.evaluate(async()=>{const app=window.awunApp,tracks=window.SongvaleCollections.local.tracks;window.SongvaleContinuous.settings.crossfade=2;app.replaceQueue(tracks,'manual');await app.playTrack(tracks[0],{preserveQueue:true})});
  await expect.poll(()=>page.evaluate(()=>window.SongvaleContinuous.state().status)).toBe('ready');
  const snapshot=await page.evaluate(()=>({active:document.querySelector('#audio').src,store:window.SongvaleCollections.local.activeURL,standby:document.querySelector('#audioStandby').src}));expect(snapshot.active).toBe(snapshot.store);expect(snapshot.standby).not.toBe(snapshot.active);
  await expect(page.locator('#nowTitle')).toHaveText('Two',{timeout:12000});await expect.poll(()=>page.evaluate(()=>document.querySelector('#audio').currentTime)).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.awunApp.state.fadingFileId)).toBeNull();
  expect(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('awun-listening-v1')).tracks).reduce((n,s)=>n+s.plays,0))).toBeGreaterThanOrEqual(1);
});

for(const width of [390,1280])test(`the logo, round play and useful sidebar controls fit ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});await setup(page);await search(page);await page.locator('#trackList .track').first().locator('.play').click();
  const bounds=await page.locator('#playPause').evaluate(button=>{const box=button.getBoundingClientRect();return {radius:getComputedStyle(button).borderRadius,width:box.width,height:box.height}});expect(bounds.radius).toBe('50%');expect(bounds.width).toBe(bounds.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if(width>=1100){await expect(page.locator('#sidebarContinue')).toBeVisible();await expect(page.locator('#sidebarOffline')).toBeVisible()}
  mkdirSync('test-results/feature-qa',{recursive:true});await page.screenshot({path:`test-results/feature-qa/product-${width}.png`,fullPage:true});
});


test('phone queue menu offers every source of the grouped recording',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);await search(page);
  const row=page.locator('#trackList .track').filter({hasText:'Midnight Signal'});
  await row.locator('.track-queue-menu summary').click();await expect(row.locator('[data-queue-source]')).toHaveCount(3);
  await row.locator('[data-queue-source="youtube"]').click();await expect(page.locator('#nowSource')).toHaveText('YouTube');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('later provider copies preserve an open recording menu and its keyboard focus',async({page})=>{
  await openAwun(page,{delays:{youtube:10,soundcloud:650,audius:850,jamendo:1000,internet_archive:1200}});await searchFor(page,'midnight signal');
  const row=page.locator('#trackList .track').filter({hasText:'Midnight Signal'}),summary=row.locator('.track-queue-menu summary');
  await summary.click();await expect(summary).toBeFocused();await expect(page.locator('#results')).toHaveAttribute('aria-busy','false');
  await expect(row).toHaveCount(1);await expect(row.locator('.track-queue-menu')).toHaveAttribute('open','');await expect(summary).toBeFocused();
  await expect(row.locator('[data-queue-source]')).toHaveCount(3);
});
