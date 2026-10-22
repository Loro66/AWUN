const {test,expect} = require('@playwright/test');
const {installApiMocks,installMediaMocks,TRACKS} = require('./fixtures');

async function openDesktop(page,options={}) {
  const events=[];
  await page.exposeFunction('nativeEvent',event=>events.push(event));
  await installApiMocks(page);await installMediaMocks(page);
  await page.addInitScript(options=>{
    const state=window.nativeTest={failRead:!!options.failRead,failSave:false,delay:0,activeWrites:0,maxWrites:0,writes:[],closed:0,cancelled:0,loads:0};
    window.pywebview={api:{
      load_state:async()=>{
        state.loads++;await window.nativeEvent('load-start');
        if(options.loadDelay)await new Promise(resolve=>setTimeout(resolve,options.loadDelay));
        if(state.failRead)throw new Error('read failed');
        await window.nativeEvent('load-finished');return JSON.stringify(options.saved||{});
      },
      save_state:async raw=>{
        state.activeWrites++;state.maxWrites=Math.max(state.maxWrites,state.activeWrites);
        await window.nativeEvent('save-start');
        if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
        state.writes.push(JSON.parse(raw));state.activeWrites--;return !state.failSave;
      },
      desktop_status:async()=>({supported:true,tray:true,hotkeys:true,close_to_tray:true,mini:false,shortcuts:[]}),
      desktop_frontend_ready:async()=>true,
      desktop_close_ready:async()=>{state.closed++;return true;},
      desktop_close_cancel:async()=>{state.cancelled++;return true;},
      desktop_command:async action=>{if(action==='quit')state.closed++;return true;},
    }};
    window.addEventListener('DOMContentLoaded',()=>{
      window.dispatchEvent(new Event('pywebviewready'));window.dispatchEvent(new Event('pywebviewready'));
    });
  },options);
  await page.goto(options.languageFromDisk?'/?desktop=1':'/?desktop=1&lang=ru');
  return events;
}

test('slow native restoration never writes startup defaults over a saved library',async({page})=>{
  const saved={'awun-library':JSON.stringify([TRACKS.audius[0]]),'songvale-account-owner-v1':'owner-a'};
  const events=await openDesktop(page,{saved,loadDelay:400});
  await expect(page.locator('html')).not.toHaveClass(/desktop-restoring/);
  await expect.poll(()=>page.evaluate(()=>window.nativeTest.writes.length)).toBeGreaterThan(0);
  expect(events.indexOf('save-start')).toBeGreaterThan(events.indexOf('load-finished'));
  expect((await page.evaluate(()=>window.nativeTest.writes)).every(data=>JSON.parse(data['awun-library']||'[]').some(t=>t.id==='audius_midnight-signal'))).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('songvale-account-owner-v1'))).toBe('owner-a');
});

test('repeated bridge-ready events restore only once without reloading an empty profile',async({page})=>{
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await openDesktop(page,{loadDelay:100});
  await expect(page.locator('html')).not.toHaveClass(/desktop-restoring/);
  expect(await page.evaluate(()=>window.nativeTest.loads)).toBe(1);
  expect(navigations).toBe(1);
});

test('native saves serialize overlapping edits and retain the latest snapshot',async({page})=>{
  await openDesktop(page);await expect(page.locator('html')).not.toHaveClass(/desktop-restoring/);
  const result=await page.evaluate(async()=>{
    await window.awunDesktopFlush();
    window.nativeTest.delay=130;window.nativeTest.maxWrites=0;
    localStorage.setItem('awun-native-probe','first');const first=window.awunDesktopFlush();
    await new Promise(resolve=>setTimeout(resolve,20));
    localStorage.setItem('awun-native-probe','last');const last=window.awunDesktopFlush();
    const saved=await Promise.all([first,last]);
    return {saved,max:window.nativeTest.maxWrites,value:window.nativeTest.writes.at(-1)['awun-native-probe']};
  });
  expect(result).toEqual({saved:[true,true],max:1,value:'last'});
});

test('unreadable native state stays untouched until a successful retry',async({page})=>{
  await openDesktop(page,{failRead:true});
  await expect(page.locator('#desktopStorageNotice')).toContainText('Файлы сохранены');
  expect(await page.evaluate(()=>window.nativeTest.writes.length)).toBe(0);
  await page.evaluate(()=>window.nativeTest.failRead=false);
  await page.locator('#desktopStorageRetry').click();
  await expect(page.locator('#desktopStorageNotice')).toBeHidden();
  expect(await page.evaluate(()=>window.awunDesktopFlush())).toBe(true);
});

test('explicit quit waits for persistence and a disk failure leaves a visible retry',async({page})=>{
  await openDesktop(page);await expect(page.locator('html')).not.toHaveClass(/desktop-restoring/);
  await page.evaluate(async()=>{await window.awunDesktopFlush();window.nativeTest.failSave=true;localStorage.setItem('awun-native-probe','new edit');});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('songvale:desktop-command',{detail:{action:'quit'}})));
  await expect(page.locator('#desktopStorageNotice')).toContainText('не записались');
  expect(await page.evaluate(()=>window.nativeTest.closed)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.nativeTest.cancelled)).toBe(1);
  await page.evaluate(()=>window.nativeTest.failSave=false);await page.locator('#desktopStorageRetry').click();
  await expect(page.locator('#desktopStorageNotice')).toBeHidden();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('songvale:desktop-command',{detail:{action:'quit'}})));
  await expect.poll(()=>page.evaluate(()=>window.nativeTest.closed)).toBe(1);
  expect(await page.evaluate(()=>window.nativeTest.writes.at(-1)['awun-native-probe'])).toBe('new edit');
});

test('the language restored from disk is retained by the native launch URL',async({page})=>{
  await openDesktop(page,{saved:{'awun-language':'en'},languageFromDisk:true});
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('#libraryButton')).toHaveAttribute('aria-label','LIBRARY');
});
