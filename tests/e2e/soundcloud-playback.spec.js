const { test,expect }=require('@playwright/test');
const { openAwun,searchFor,TRACKS }=require('./fixtures');

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
