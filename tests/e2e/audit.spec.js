const { test, expect } = require('@playwright/test');
const { openAwun, searchFor, TRACKS, installMediaMocks, installApiMocks } = require('./fixtures');
test.beforeEach(async({page})=>{page._auditErrors=[];page.on('pageerror',error=>page._auditErrors.push(error.message));});
test.afterEach(async({page})=>expect(page._auditErrors).toEqual([]));
async function ready(page) { await openAwun(page);await searchFor(page,'midnight signal');await expect(page.locator('#results')).toHaveAttribute('aria-busy','false'); }

test('Wave history and blocked artists switch with the owner and restore on return',async({page})=>{
  await ready(page);await page.locator('#trackList .track[data-source="audius"] .play').first().click();await page.locator('#flowLike').evaluate(button=>button.click());
  expect(await page.evaluate(()=>window.awunApp.state.flow.profile.signals.some(signal=>signal.type==='like'))).toBe(true);
  await page.evaluate(()=>{localStorage.setItem('songvale-account-owner-v1','another-owner');window.awunApp.render();});
  expect(await page.evaluate(()=>window.awunApp.state.flow.profile.signals.length)).toBe(0);
  await page.evaluate(()=>{localStorage.removeItem('songvale-account-owner-v1');window.awunApp.render();});
  expect(await page.evaluate(()=>window.awunApp.state.flow.profile.signals.some(signal=>signal.type==='like'))).toBe(true);
});
test('Wave does not recommend a disliked recording through a different source',async({page})=>{
  await page.addInitScript(track=>localStorage.setItem('awun-wave-profile-v2',JSON.stringify({signals:[{...track,type:'dislike',at:Date.now()}],blockedArtists:[]})),TRACKS.soundcloud[0]);
  await ready(page);await page.evaluate(()=>window.songvaleTaste.store.updateSettings({continuous:false}));
  await page.locator('#flowButton').click();await page.locator('#flowStart').click();
  expect(await page.evaluate(()=>window.awunApp.state.tracks.some(track=>track.title==='Midnight Signal'))).toBe(false);
});
test('seeking to the end does not count as listening or completion in Wave',async({page})=>{
  await page.clock.install();await ready(page);await page.locator('#trackList .track[data-source="audius"] .play').first().click();
  await page.locator('#audio').evaluate(audio=>{audio.currentTime=205;});
  const feedback=()=>page.evaluate(()=>window.awunApp.state.flow.profile.signals.filter(signal=>['listen30','complete'].includes(signal.type)).map(signal=>signal.type));
  expect(await feedback()).toEqual([]);
  await page.clock.runFor(31_000);expect(await feedback()).toEqual(['listen30']);
  await page.clock.runFor(142_000);expect(await feedback()).toEqual(['listen30','complete']);
});
test('untrusted backup download and annotation URLs cannot create script links',async({page})=>{
  await ready(page);
  await page.evaluate(()=>{const app=window.awunApp;app.state.tracks=[{...app.state.tracks[0],download_url:'javascript:window.auditInjected=true'}];app.render();});
  await expect(page.locator('#trackList .download')).toHaveCount(0);
});
test('desktop restoration retains the library owner and cloud restore guard',async({page})=>{
  await installMediaMocks(page);await installApiMocks(page);
  await page.addInitScript(()=>{
    window.desktopSaved=[];
    window.pywebview={api:{load_state:async()=>JSON.stringify({'awun-library':'[]','songvale-account-owner-v1':'account-a','songvale-backup-restore-pending-v1':'account-a','songvale-account-sync-account-a':'{"revision":12,"dirty":true}','songvale_access':'never-restore'}),save_state:async value=>{window.desktopSaved.push(JSON.parse(value));return true}}};
    window.addEventListener('load',()=>window.dispatchEvent(new Event('pywebviewready')));
  });
  await page.goto('/?desktop=1&lang=ru');
  await expect.poll(async()=>{try{return await page.evaluate(()=>localStorage.getItem('songvale-account-owner-v1'))}catch{return null}}).toBe('account-a');
  const saved=await page.evaluate(async()=>{await window.awunDesktopFlush();return window.desktopSaved.at(-1)});
  expect(saved['songvale-backup-restore-pending-v1']).toBe('account-a');expect(saved['songvale-account-sync-account-a']).toContain('12');expect(saved.songvale_access).toBeUndefined();
});


test('Wave feedback controls are reachable on desktop and phone and pause a rejected last track',async({page})=>{
  await ready(page);await page.locator('#trackList .track[data-source="audius"] .play').first().click();
  await page.locator('#flowButton').click();await page.locator('.flow-tuning summary').click();
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});
    for(const id of ['flowLikeAction','flowDislikeAction','flowBlockAction'])await expect(page.locator('#'+id)).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.locator('#flowLikeAction').click();await expect(page.locator('#flowLikeAction')).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>{const app=window.awunApp;app.state.tracks=[app.state.active];app.replaceQueue([],'context');app.render()});
  await page.locator('#flowDislikeAction').click();
  expect(await page.evaluate(()=>window.awunApp.state.isPlaying)).toBe(false);
});

test('clearing storage in another tab does not resurrect the previous Wave profile',async({page})=>{
  await ready(page);await page.locator('#trackList .track[data-source="audius"] .play').first().click();
  await page.locator('#flowLike').evaluate(button=>button.click());
  await page.evaluate(()=>{localStorage.clear();window.dispatchEvent(new StorageEvent('storage',{key:null}))});
  expect(await page.evaluate(()=>window.awunApp.state.flow.profile.signals.length)).toBe(0);
});
