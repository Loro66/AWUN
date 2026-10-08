const { test,expect }=require('@playwright/test');
const { openAwun,searchFor,TRACKS }=require('./fixtures');

async function mockSoundCloudSearch(page,track){
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON(),tracks=body.sources.includes('soundcloud')?[track]:[];
    return route.fulfill({ json:{ query:body.query,tracks,total:tracks.length,searched_sources:body.sources,errors:{} } });
  });
}

test('SoundCloud HLS plays when the browser advertises unusable native support',async({ page })=>{
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType=function(type){return type.includes('mpegurl')?'maybe':original.call(this,type)};
    window.Hls=class {
      static isSupported(){return true}
      static Events={ERROR:'error',MANIFEST_PARSED:'manifestParsed',MEDIA_ATTACHED:'mediaAttached'};
      constructor(){this.handlers=new Map()}
      on(event,callback){this.handlers.set(event,callback)}
      attachMedia(media){this.media=media;media.hlsAttached=true;this.handlers.get('mediaAttached')?.()}
      loadSource(url){window.lastHlsSource=url;queueMicrotask(()=>this.handlers.get('manifestParsed')?.())}
      destroy(){this.media.hlsAttached=false}
    };
  });
  await openAwun(page);
  await page.evaluate(()=>{
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){return this.hlsAttached?play.call(this):Promise.reject(new DOMException('Native HLS decoding failed','NotSupportedError'))};
  });
  const track={...TRACKS.soundcloud[0],title:'Montagem Bailow 2',artist:'TWXNY · KPHK · Innxcence',duration:88,stream_type:'hls',stream_url:'/__fixture__/playlist.m3u8'};
  await mockSoundCloudSearch(page,track);
  await searchFor(page,'montagem bailow 2');
  await page.locator('#trackList .track[data-source="soundcloud"] .play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#nowTitle')).toHaveText('Montagem Bailow 2');
  await expect(page.locator('#playerStatus')).toHaveText('');
  expect(await page.evaluate(()=>window.lastHlsSource)).toBe(track.stream_url);
});

test('SoundCloud HLS keeps native playback on devices without MediaSource',async({ page })=>{
  await page.addInitScript(()=>{
    HTMLMediaElement.prototype.canPlayType=()=> 'maybe';
    window.Hls=class { static isSupported(){return false} constructor(){throw new Error('Unsupported MediaSource')} };
  });
  await openAwun(page);
  const track={...TRACKS.soundcloud[0],stream_type:'hls'};
  await mockSoundCloudSearch(page,track);
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="soundcloud"] .play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#audio')).toHaveAttribute('src',track.stream_url);
  expect(await page.evaluate(()=>window.awunApp.state.hls)).toBeNull();
});

test('native HLS can play when the bundled player fails to load',async({ page })=>{
  await page.addInitScript(()=>{HTMLMediaElement.prototype.canPlayType=()=> 'maybe'});
  await openAwun(page);
  await page.route('**/hls.light.min.js*',route=>route.abort());
  await mockSoundCloudSearch(page,{...TRACKS.soundcloud[0],stream_type:'hls'});
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="soundcloud"] .play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#playerStatus')).toHaveText('');
});

test('a playable SoundCloud preview is labelled as an excerpt',async({ page })=>{
  await openAwun(page);
  const preview={...TRACKS.soundcloud[0],title:'Ceux qui rêvent',artist:'Pomme',duration:30,is_preview:true};
  await mockSoundCloudSearch(page,preview);
  await searchFor(page,'pomme ceux qui rêvent');
  const row=page.locator('#trackList .track[data-source="soundcloud"]');
  await expect(row.locator('.quality')).toHaveText('Фрагмент');
  await row.locator('.play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#nowSource')).toHaveText('SoundCloud · Фрагмент');
  await expect(page.locator('#playerStatus')).toHaveText('SoundCloud отдаёт только фрагмент этой записи.');
});

test('a failed 30-second SoundCloud preview recovers to the full original',async({ page })=>{
  await openAwun(page);
  await page.evaluate(()=>{
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){return this.src.includes('preview.mp3')?Promise.reject(new DOMException('Preview decoding failed','NotSupportedError')):play.call(this)};
  });
  const preview={...TRACKS.soundcloud[0],title:'Ceux qui rêvent',artist:'Pomme',duration:30,is_preview:true,stream_url:'/__fixture__/audio/preview.mp3'};
  const full={...TRACKS.youtube[0],title:'Pomme - Ceux qui rêvent (Official Audio)',artist:'Pomme - Topic',duration:170};
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON();
    const tracks=body.sources.includes('soundcloud')?[preview]:body.sources.includes('youtube')?[
      {...full,id:'yt_live',title:'Pomme - Ceux qui rêvent (live)',score:100},
      {...full,id:'yt_cover',title:'Pomme - Ceux qui rêvent (cover)',score:100},
      full,
    ]:[];
    return route.fulfill({ json:{ query:body.query,tracks,total:tracks.length,searched_sources:body.sources,errors:{} } });
  });
  await searchFor(page,'pomme ceux qui rêvent');
  await page.locator('#trackList .track[data-source="soundcloud"] .play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#nowTitle')).toHaveText(full.title);
  await expect(page.locator('#nowSource')).toHaveText('YouTube');
  await expect(page.locator('#playerStatus')).toHaveText('');
});

test('SoundCloud direct audio is not passed to the HLS player',async({ page })=>{
  await page.addInitScript(()=>{
    const original=HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType=function(type){return type.includes('mpegurl')?'':original.call(this,type)};
    window.Hls=class { static isSupported(){return true} constructor(){throw new Error('Direct audio must not use HLS')} };
  });
  await openAwun(page);
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON(),tracks=body.sources.includes('soundcloud')?[{ ...TRACKS.soundcloud[0],stream_type:'audio' }]:[];
    return route.fulfill({ json:{ query:body.query,tracks,total:tracks.length,searched_sources:body.sources,errors:{} } });
  });
  await searchFor(page,'midnight signal');
  await page.locator('#trackList .track[data-source="soundcloud"] .play').click();
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#nowSource')).toHaveText('SoundCloud');
  expect(await page.evaluate(()=>window.awunApp.state.hls)).toBeNull();
});

test('an expired SoundCloud link refreshes even when the song was found in the same tab',async({ page })=>{
  await openAwun(page);
  const refreshes=[];
  const fresh={ ...TRACKS.soundcloud[0],stream_type:'audio',stream_url:TRACKS.soundcloud[0].stream_url.replace('midnight-signal','fresh-link') };
  await page.route('**/api/v1/search',route=>{
    const body=route.request().postDataJSON();
    if(body.refresh)refreshes.push(body);
    const tracks=body.sources.includes('soundcloud')?[body.refresh?fresh:{ ...TRACKS.soundcloud[0],stream_type:'audio' }]:[];
    return route.fulfill({ json:{ query:body.query,tracks,total:tracks.length,searched_sources:body.sources,errors:{} } });
  });
  await searchFor(page,'midnight signal');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy','false');
  const started=await page.evaluate(async()=>{
    const track=window.awunApp.state.tracks.find(item=>item.source==='soundcloud');
    track.stream_expires_at=Date.now()-1;
    return window.awunApp.playTrack(track);
  });
  expect(started).toBe(true);
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0]).toMatchObject({ sources:['soundcloud'],refresh:true,fast:false });
  await expect(page.locator('#audio')).toHaveAttribute('src',fresh.stream_url);
  await expect(page.locator('body')).toHaveClass(/is-playing/);
  await expect(page.locator('#playerStatus')).toHaveText('');
});
