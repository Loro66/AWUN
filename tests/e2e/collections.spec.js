const {test,expect}=require('@playwright/test');
const {openAwun,searchFor,installApiMocks,installMediaMocks}=require('./fixtures');

const ARTIST='12345678-1234-1234-1234-123456789abc';
const ALBUM='12345678-1234-1234-1234-123456789def';
const album={id:ALBUM,title:'Night Record',artist:'AWUN Artist',date:'2026',edition:'2026',tracks:[{id:'one',title:'Midnight Signal',artist:'AWUN Artist',duration:214,disc:1,position:1},{id:'two',title:'Missing Recording',artist:'AWUN Artist',duration:214,disc:1,position:2}]};
async function catalogMocks(page,{ambiguous=false}={}){
  await page.route('**/api/v1/catalog/artists?**',route=>route.fulfill({json:{artists:[{id:ARTIST,name:'AWUN Artist',score:100},...(ambiguous?[{id:'87654321-1234-1234-1234-123456789abc',name:'AWUN Artist',description:'Different artist',score:100}]:[])]}}));
  await page.route('**/api/v1/catalog/artists/*/albums?**',route=>route.fulfill({json:{artist:{id:ARTIST,name:'AWUN Artist'},albums:[{id:ALBUM,title:album.title,artist:album.artist,date:'2026',type:'Album'}],offset:0,total:1}}));
  await page.route(`**/api/v1/catalog/albums/${ALBUM}`,route=>route.fulfill({json:album}));
}
function wave(seconds=10){const size=8000*seconds*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b}
async function importWave(page,name='Example — Own Song.wav',seconds=10){await page.locator('#localAudioInput').setInputFiles({name,mimeType:'audio/wav',buffer:wave(seconds)});await expect(page.locator('#collectionStatus')).toContainText('Добавлено: 1')}

test('artist links open a catalog page and save the whole album including an unavailable track',async({page})=>{
  await catalogMocks(page);await openAwun(page);await searchFor(page,'midnight signal');
  await page.locator('#trackList .artist-link').first().click();await expect(page.locator('#collectionTitle')).toHaveText('AWUN Artist');
  await page.locator('.collection-album').click();await expect(page.locator('#collectionTitle')).toHaveText(album.title);
  await expect(page.locator('.collection-track-copy strong')).toHaveText(['Midnight Signal','Missing Recording']);
  await page.getByRole('button',{name:'Сохранить альбом',exact:true}).click();await expect(page.locator('#collectionStatus')).toContainText('целиком сохранён');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('awun-albums-v1'))[0].tracks.map(t=>t.title))).toEqual(['Midnight Signal','Missing Recording']);
  await page.reload();await page.locator('#libraryButton').click();await page.locator('#savedAlbumsButton').click();await page.locator('.collection-album').click();
  await expect(page.locator('.collection-track')).toHaveCount(2);
  await page.locator('.collection-track').first().locator('.collection-play').click();await expect(page.locator('#nowTitle')).toHaveText('Midnight Signal');
  expect(await page.evaluate(()=>window.awunApp.state.queue[0].catalog_entry.title)).toBe('Missing Recording');
});

test('artists with the same name require an explicit choice',async({page})=>{
  await catalogMocks(page,{ambiguous:true});await openAwun(page);await page.evaluate(()=>window.SongvaleCollections.openArtist('AWUN Artist'));
  await expect(page.locator('.catalog-artist-choice')).toHaveCount(2);await expect(page.locator('.collection-album')).toHaveCount(0);
  await page.locator('.catalog-artist-choice').first().click();await expect(page.locator('.collection-album')).toHaveCount(1);
});

test('a slower artist response cannot overwrite a later artist choice',async({page})=>{
  await catalogMocks(page,{ambiguous:true});
  await page.route('**/api/v1/catalog/artists/*/albums?**',async route=>{const first=route.request().url().includes(ARTIST);await new Promise(resolve=>setTimeout(resolve,first?150:5));await route.fulfill({json:{artist:{name:first?'First choice':'Second choice'},albums:[],total:0}})});
  await openAwun(page);await page.evaluate(()=>window.SongvaleCollections.openArtist('AWUN Artist'));await expect(page.locator('.catalog-artist-choice')).toHaveCount(2);
  const older=page.waitForResponse(response=>response.url().includes(ARTIST)&&response.url().includes('/albums?'));
  await page.evaluate(()=>document.querySelectorAll('.catalog-artist-choice').forEach(button=>button.click()));await older;
  await expect(page.locator('#collectionTitle')).toHaveText('Second choice');
});

test('catalog failure tries the configured backup only once',async({page})=>{
  const calls=[];await page.route('**/api/v1/catalog/artists?**',route=>{calls.push(new URL(route.request().url()).origin);return route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},json:{detail:'unavailable'}})});
  await installMediaMocks(page);await installApiMocks(page);await page.goto('/?lang=ru&fallback_api=https%3A%2F%2Fcatalog-mirror.example');
  await page.evaluate(()=>window.SongvaleCollections.openArtist('Example'));
  expect(calls).toEqual(['http://127.0.0.1:4173','https://catalog-mirror.example']);
  await expect(page.locator('#collectionStatus')).not.toBeEmpty();
});

test('a missing recording stays saved and does not play an unrelated result',async({page})=>{
  await catalogMocks(page);await openAwun(page);await page.evaluate(album=>window.SongvaleCollections.openAlbum(album),album);
  await page.locator('.collection-track').nth(1).locator('.collection-play').click();await expect(page.locator('#collectionStatus')).toContainText('не найдена подходящая запись');
  expect(await page.evaluate(()=>window.awunApp.state.active)).toBeNull();await expect(page.locator('.collection-track')).toHaveCount(2);
});

test('local audio survives reload, rejects duplicate bytes and groups edited album tags',async({page})=>{
  await openAwun(page);await importWave(page);await page.locator('#localAudioInput').setInputFiles({name:'Different filename.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.locator('#collectionStatus')).toContainText('Уже есть: 1');await expect(page.locator('.collection-track')).toHaveCount(1);
  await page.getByRole('button',{name:'Изменить описание',exact:true}).click();await page.locator('#localEditorAlbum').fill('My Record');await page.locator('#localEditor').getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(page.locator('.collection-album')).toHaveCount(1);await page.reload();await page.locator('#libraryButton').click();await page.locator('#localFilesButton').click();
  await expect(page.locator('.collection-track-copy strong')).toHaveText('Own Song');await expect(page.locator('.collection-album strong')).toHaveText('My Record');
  await page.locator('.collection-play').click();await expect(page.locator('#nowTitle')).toHaveText('Own Song');
  const snapshot=await page.evaluate(()=>({source:window.awunApp.state.active.source,active:window.awunApp.state.active.stream_url,recent:JSON.parse(localStorage.getItem('awun-recent'))[0].stream_url,saved:window.awunApp.state.saved}));
  expect(snapshot.source).toBe('local');expect(snapshot.active).toMatch(/^blob:/);expect(snapshot.recent).toBe('');expect(snapshot.saved).toEqual([]);
  await expect(page.locator('#playerSave')).toBeDisabled();
  await page.locator('#collectionBack').click();await expect(page.locator('#trackList .track[data-source="local"]')).toHaveCount(1);
  await expect(page.locator('#libraryButton b')).toHaveText('01');
});

test('native import stays on loopback and playback uses the current launch token',async({page})=>{
  const token='this-launch-token',track={id:`local_${'a'.repeat(64)}`,file_id:'a'.repeat(64),title:'Own Song',artist:'Example',album:'',source:'local',stream_url:'',mime:'audio/wav',duration:10};let uploaded=false,origin='',header='';
  await page.addInitScript(token=>{window.pywebview={api:{local_audio_config:async()=>({token})}}},token);
  await page.route('**/api/v1/local-audio',async route=>{
    const request=route.request();expect(request.headers()['x-songvale-local-token']).toBe(token);
    if(request.method()==='POST'){uploaded=true;origin=request.headers().origin;header=request.headers()['x-songvale-local-metadata'];return route.fulfill({json:{track,duplicate:false}})}
    return route.fulfill({json:{tracks:uploaded?[track]:[]}});
  });
  await installMediaMocks(page);await installApiMocks(page);await page.goto('/?lang=ru&desktop=1');await importWave(page);
  expect(origin).toBe('http://127.0.0.1:4173');expect(JSON.parse(decodeURIComponent(header)).title).toBe('Own Song');
  await page.reload();await page.locator('#libraryButton').click();await page.locator('#localFilesButton').click();await page.locator('.collection-play').click();
  expect(await page.evaluate(()=>window.awunApp.state.active.stream_url)).toContain(`token=${token}`);
  expect(await page.evaluate(()=>localStorage.getItem('awun-recent'))).not.toContain(token);
});

test('a cancelled file read cannot revoke the currently playing file URL',async({page})=>{
  await openAwun(page);await importWave(page);await page.locator('.collection-play').click();
  const result=await page.evaluate(async()=>{const store=window.SongvaleCollections.local,url=store.activeURL,controller=new AbortController();controller.abort();let error='';try{await store.resolve(store.tracks[0],controller.signal)}catch(e){error=e.name}const audio=new Audio(url),exists=await new Promise(resolve=>{audio.onloadedmetadata=()=>resolve(true);audio.onerror=()=>resolve(false)});audio.removeAttribute('src');audio.load();return {error,unchanged:store.activeURL===url,exists}});
  expect(result).toEqual({error:'AbortError',unchanged:true,exists:true});
});

test('a corrupt file reports an error without creating a phantom track',async({page})=>{
  await openAwun(page);await page.locator('#localAudioInput').setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('not audio')});
  await expect(page.locator('#collectionStatus')).toContainText('Ошибок: 1');await expect(page.locator('.collection-track')).toHaveCount(0);
});

test('removing a local file deletes both its metadata and the stored audio',async({page})=>{
  await openAwun(page);await importWave(page);await page.getByRole('button',{name:'Удалить файл',exact:true}).click();await expect(page.locator('.collection-track')).toHaveCount(0);
  const count=await page.evaluate(async()=>{const store=window.SongvaleCollections.local,db=await store.openDatabase();return await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').count();r.onsuccess=()=>resolve(r.result)})});expect(count).toBe(0);
});

test('the cached web app plays real imported audio after an offline reload',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow'});const page=await context.newPage();
  try{
    await installApiMocks(page);await page.goto('http://127.0.0.1:4173/?lang=ru');await page.evaluate(()=>navigator.serviceWorker.ready);
    await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
    await importWave(page);await context.setOffline(true);await page.reload();await page.locator('#libraryButton').click();await page.locator('#localFilesButton').click();
    await expect(page.locator('.collection-track')).toHaveCount(1);await page.locator('.collection-play').click();
    await expect.poll(()=>page.evaluate(()=>document.querySelector('#audio').currentTime)).toBeGreaterThan(0);
    expect(await page.evaluate(()=>window.awunApp.state.active.stream_url)).toMatch(/^blob:/);
  }finally{await context.close()}
});

for(const width of [320,390,1280])test(`catalog and file controls fit ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:850});await catalogMocks(page);await openAwun(page);await page.evaluate(album=>window.SongvaleCollections.openAlbum(album),album);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for(const selector of ['#collectionBack','.collection-play','.collection-add']){const rect=await page.locator(selector).first().boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width)}
  await page.screenshot({path:testInfo.outputPath(`catalog-${width}.png`)});
});
