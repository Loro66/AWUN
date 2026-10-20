const {test,expect}=require('@playwright/test');
const {installApiMocks,installMediaMocks,TRACKS}=require('./fixtures');

function wave(seconds=10){const size=8000*seconds*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b}
const track={...TRACKS.audius[0],duration:214,offline_allowed:true,offline_url:'http://127.0.0.1:4173/api/v1/media/offline-fixture?offline=1',license_url:'https://audius.org/open-music-license.pdf'};
async function setup(page,{real=false,response=null,clock=false}={}){
  let downloads=0;
  if(!real)await installMediaMocks(page);await installApiMocks(page);
  await page.route('**/api/v1/search',route=>route.fulfill({json:{tracks:[track],total:1,searched_sources:['audius'],query:'Midnight Signal',errors:{},elapsed_ms:1}}));
  await page.route('**/api/v1/media/offline-fixture?offline=1',async route=>{downloads++;await route.fulfill(response||{headers:{'content-type':'audio/wav'},body:wave()})});
  if(clock)await page.clock.install();await page.goto('http://127.0.0.1:4173/?lang=ru');await page.evaluate(()=>window.SongvaleOffline.ready);
  return ()=>downloads;
}
async function like(page,value=track){await page.evaluate(t=>window.awunApp.toggleSave(t),value)}
async function ready(page){await expect.poll(()=>page.evaluate(t=>window.SongvaleOffline.stateFor(t),track)).toBe('ready')}
async function advance(page,seconds){for(let i=0;i<seconds;i++){await page.evaluate(()=>document.querySelector('#audio').currentTime++);await page.clock.runFor(1000)}}
async function plays(page){return page.evaluate(t=>JSON.parse(localStorage.getItem('awun-listening-v1')||'{}').tracks?.[`${t.source}:${t.id}`]?.plays||0,track)}

test('a like saves validated audio once and cached playback retains the provider identity',async({page})=>{
  const downloads=await setup(page);await like(page);await ready(page);
  await like(page);await like(page);await page.evaluate(()=>window.SongvaleOffline.pump());expect(downloads()).toBe(1);
  const result=await page.evaluate(async t=>{const app=window.awunApp;await app.search('Midnight Signal');await app.playTrack(t);return {active:app.state.active,library:app.libraryTracks(),jobs:localStorage.getItem('awun-offline-profiles-v2'),saved:localStorage.getItem('awun-library'),files:window.SongvaleCollections.local.tracks}},track);
  expect(result.active.source).toBe('audius');expect(result.active.offline_playback).toBe(true);expect(result.active.stream_url).toMatch(/^blob:/);
  expect(result.library).toHaveLength(1);expect(result.files).toHaveLength(1);expect(result.files[0].managed_download).toBe(true);
  expect(result.saved).not.toContain('blob:');expect(result.saved).not.toContain('offline-fixture');expect(result.jobs).not.toContain('offline-fixture');
});

test('three real qualified listens download once; a paused or stalled playhead and seeking do not count',async({page})=>{
  const downloads=await setup(page,{clock:true});await page.evaluate(t=>window.awunApp.playTrack(t),track);
  await page.clock.runFor(32000);expect(await plays(page)).toBe(0);
  await page.evaluate(()=>{window.awunApp.pausePlayback();document.querySelector('#audio').currentTime=100});await page.clock.runFor(32000);expect(await plays(page)).toBe(0);
  await page.locator('#playPause').click();await page.evaluate(()=>document.querySelector('#audio').currentTime=200);await page.clock.runFor(1000);expect(await plays(page)).toBe(0);
  await page.evaluate(()=>document.querySelector('#audio').currentTime=0);await page.clock.runFor(1000);
  for(let i=0;i<31;i++){await page.evaluate(()=>{const progress=document.querySelector('#progress');progress.value=(document.querySelector('#audio').currentTime+1)/214*1000;progress.dispatchEvent(new Event('change'))});await page.clock.runFor(1000)}
  expect(await plays(page)).toBe(0);
  await page.evaluate(()=>{document.querySelector('#audio').currentTime=0;window.awunApp.state.repeatMode='one'});await page.clock.runFor(1000);
  for(let i=1;i<=3;i++){
    await advance(page,31);expect(await plays(page)).toBe(i);
    if(i<3){expect(downloads()).toBe(0);await page.evaluate(()=>document.querySelector('#audio').dispatchEvent(new Event('ended')));await page.clock.runFor(1000)}
  }
  await ready(page);expect(downloads()).toBe(1);
});

test('providers without an offline grant remain liked and never fetch a download',async({page})=>{
  const downloads=await setup(page);
  for(const item of [{...TRACKS.soundcloud[0],title:'Unsupported SoundCloud'},{...TRACKS.youtube[0],title:'Unsupported YouTube'},{...track,id:'no-grant',offline_allowed:false},{...track,id:'preview',is_preview:true}])await like(page,item);
  await expect.poll(()=>page.evaluate(()=>window.SongvaleOffline.jobs.filter(j=>j.state==='blocked').length)).toBe(4);
  expect(downloads()).toBe(0);expect(await page.evaluate(()=>window.awunApp.state.saved.length)).toBe(4);
});

for(const [name,response] of [['corrupt',{headers:{'content-type':'audio/wav'},body:Buffer.from('not audio')}],['html',{headers:{'content-type':'text/html'},body:'<html>sign in</html>'}],['hls',{headers:{'content-type':'application/vnd.apple.mpegurl'},body:'#EXTM3U'}]])test(`a ${name} response cannot create a ready offline copy`,async({page})=>{
  await setup(page,{response});await like(page);await expect.poll(()=>page.evaluate(()=>window.SongvaleOffline.jobs[0]?.state)).toBe('error');
  expect(await page.evaluate(()=>window.SongvaleCollections.local.tracks.length)).toBe(0);
});

test('the queue resumes on reconnect and survives reload with a fresh link',async({page,context})=>{
  const downloads=await setup(page);await context.setOffline(true);await like(page);await expect.poll(()=>page.evaluate(()=>window.SongvaleOffline.jobs[0]?.state)).toBe('queued');
  await context.setOffline(false);await page.reload();await ready(page);expect(downloads()).toBeGreaterThanOrEqual(1);expect(downloads()).toBeLessThanOrEqual(2);
  const completed=downloads();await page.reload();await ready(page);expect(downloads()).toBe(completed);
  expect(await page.evaluate(()=>localStorage.getItem('awun-offline-profiles-v2'))).not.toContain('offline-fixture');
});

test('an expired download link refreshes once and stores one complete file',async({page})=>{
  await setup(page);let attempts=0;await page.route('**/api/v1/media/offline-fixture?offline=1',route=>route.fulfill(++attempts===1?{status:403,body:'expired'}:{headers:{'content-type':'audio/wav'},body:wave()}));
  await like(page);await ready(page);expect(attempts).toBe(2);expect(await page.evaluate(()=>window.SongvaleCollections.local.tracks.length)).toBe(1);
});

test('a missing cached file reports failure and uses the online recording',async({page})=>{
  await setup(page);await like(page);await ready(page);
  await page.evaluate(async t=>{const manager=window.SongvaleOffline,store=manager.store,file=manager.fileFor(t),db=await store.openDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(file.id);tx.oncomplete=resolve;tx.onerror=reject});await window.awunApp.playTrack(t)},track);
  expect(await page.evaluate(()=>window.awunApp.state.active.offline_playback)).not.toBe(true);
  expect(await page.evaluate(()=>window.SongvaleOffline.jobs[0].error)).toBe('offlineCopyFailed');
});

test('the storage budget evicts an old unliked copy and preserves imported audio',async({page})=>{
  await setup(page);let copies=0;await page.route('**/api/v1/media/offline-fixture?offline=1',route=>route.fulfill({headers:{'content-type':'audio/wav'},body:wave(10+copies++)}));
  await page.evaluate(()=>window.SongvaleOffline.settings.limit=0.2);await like(page);await ready(page);await like(page);
  await page.locator('#localAudioInput').setInputFiles({name:'Personal.wav',mimeType:'audio/wav',buffer:wave(12)});await expect(page.locator('#collectionStatus')).toContainText('Добавлено: 1');
  const other={...track,id:'audius_another',title:'Another recording'};await page.evaluate(t=>window.SongvaleOffline.request(t,{plays:3}),other);
  await expect.poll(()=>page.evaluate(t=>window.SongvaleOffline.stateFor(t),other)).toBe('ready');
  const result=await page.evaluate(t=>({state:window.SongvaleOffline.stateFor(t),files:window.SongvaleCollections.local.tracks}),track);
  expect(result.state).toBe('evicted');expect(result.files).toHaveLength(2);expect(result.files.find(f=>!f.managed_download).title).toBe('Personal');
});

test('a corrupt new download cannot evict a valid offline copy',async({page})=>{
  await setup(page);await page.evaluate(()=>window.SongvaleOffline.settings.limit=0.2);await like(page);await ready(page);await like(page);
  await page.route('**/api/v1/media/offline-fixture?offline=1',route=>route.fulfill({headers:{'content-type':'audio/wav'},body:Buffer.alloc(160044)}));
  const other={...track,id:'audius_corrupt',title:'Corrupt recording'};await page.evaluate(t=>window.SongvaleOffline.request(t,{plays:3}),other);
  await expect.poll(()=>page.evaluate(t=>window.SongvaleOffline.stateFor(t),other)).toBe('error');
  expect(await page.evaluate(t=>window.SongvaleOffline.stateFor(t),track)).toBe('ready');expect(await page.evaluate(()=>window.SongvaleCollections.local.tracks.length)).toBe(1);
});

test('clearing automatic copies preserves imported files and the currently playing copy',async({page})=>{
  await setup(page);await like(page);await ready(page);
  await page.locator('#localAudioInput').setInputFiles({name:'Artist — Personal.wav',mimeType:'audio/wav',buffer:wave(11)});await expect(page.locator('#collectionStatus')).toContainText('Добавлено: 1');
  await page.evaluate(async t=>{await window.awunApp.playTrack(t);await window.SongvaleOffline.clear()},track);
  expect(await page.evaluate(()=>window.SongvaleCollections.local.tracks.length)).toBe(2);
  await page.evaluate(async()=>{window.awunApp.pausePlayback();window.awunApp.state.active=null;await window.SongvaleOffline.clear()});
  const files=await page.evaluate(()=>window.SongvaleCollections.local.tracks);expect(files).toHaveLength(1);expect(files[0].managed_download).not.toBe(true);
});

test('a real automatically downloaded file plays from the library after a cold offline reload',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
  try{
    await setup(page,{real:true});await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
    await like(page);await ready(page);await context.setOffline(true);await page.reload();await page.locator('#libraryButton').click();
    await expect(page.locator('#trackList .track')).toHaveCount(1);
    await page.evaluate(()=>window.awunApp.playTrack(window.awunApp.state.saved[0]));
    await expect.poll(()=>page.evaluate(()=>document.querySelector('#audio').currentTime)).toBeGreaterThan(0);
    const active=await page.evaluate(()=>window.awunApp.state.active);expect(active.offline_playback).toBe(true);expect(active.source).toBe('audius');expect(active.stream_url).toMatch(/^blob:/);
    await expect(page.locator('#nowSource')).toContainText('офлайн');
  }finally{await context.close()}
});

for(const width of [320,390])test(`smart download settings fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:850});await setup(page);await page.locator('#themeButton').click();await page.locator('#offlineEnabled').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.locator('#offlineEnabled').uncheck();await like(page);expect(await page.evaluate(()=>window.SongvaleOffline.jobs.length)).toBe(0);
});

async function changeOwner(page,owner){await page.evaluate(value=>{value?localStorage.setItem('songvale-account-owner-v1',value):localStorage.removeItem('songvale-account-owner-v1');document.dispatchEvent(new CustomEvent('awun:account-owner'));window.awunApp.state.saved=[];window.awunApp.render()},owner)}
test('offline history, file lookup and clearing remain isolated across profiles sharing audio',async({page})=>{
  const downloads=await setup(page);await like(page);await ready(page);
  await page.evaluate(t=>window.awunApp.playTrack(t),track);
  await changeOwner(page,'owner-b');
  expect(await page.evaluate(()=>window.awunApp.state.active)).toBeNull();
  const foreign=await page.evaluate(t=>({job:window.SongvaleOffline.jobFor(t,true)||null,files:window.awunApp.localTracks().length,jobs:window.SongvaleOffline.jobs.length}),track);
  expect(foreign).toEqual({job:null,files:0,jobs:0});
  await page.evaluate(t=>window.SongvaleOffline.request(t,{liked:true}),track);await ready(page);expect(downloads()).toBe(2);
  expect(await page.evaluate(()=>window.SongvaleCollections.local.tracks.length)).toBe(1);
  await page.evaluate(()=>window.SongvaleOffline.clear());
  expect(await page.evaluate(()=>window.SongvaleOffline.jobs.length)).toBe(0);
  expect(await page.evaluate(()=>window.SongvaleCollections.local.tracks.length)).toBe(1);
  await changeOwner(page,'');await ready(page);
  expect(await page.evaluate(()=>window.awunApp.localTracks().length)).toBe(1);
});

test('explicitly importing a cached file creates a shared device import rather than hiding it',async({page})=>{
  await setup(page);await like(page);await ready(page);await changeOwner(page,'owner-b');
  await page.locator('#localAudioInput').setInputFiles({name:'Personal.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.locator('#collectionStatus')).toContainText('Повторы: 1');
  expect(await page.evaluate(()=>window.awunApp.localTracks().map(f=>({title:f.title,managed:!!f.managed_download})))).toEqual([{title:'Personal',managed:false}]);
});
test('switching owner during a download cannot publish the old copy into the new profile',async({page})=>{
  await setup(page);let release;
  await page.route('**/api/v1/media/offline-fixture?offline=1',route=>new Promise(resolve=>{release=async()=>{await route.fulfill({headers:{'content-type':'audio/wav'},body:wave()}).catch(()=>{});resolve()}}));
  await like(page);await expect.poll(()=>page.evaluate(()=>window.SongvaleOffline.jobs[0]?.state)).toBe('downloading');
  await changeOwner(page,'owner-b');if(release)await release();
  await expect.poll(()=>page.evaluate(()=>window.SongvaleOffline.running)).toBe(false);
  expect(await page.evaluate(()=>({jobs:window.SongvaleOffline.jobs.length,files:window.awunApp.localTracks().length}))).toEqual({jobs:0,files:0});
});
