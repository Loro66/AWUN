const {test, expect} = require('@playwright/test');
const { playSource,installApiMocks, installMediaMocks, searchFor} = require('./fixtures');

async function openNetwork(page, options = {}) {
  await installApiMocks(page);
  await installMediaMocks(page);
  await page.addInitScript(options => {
    window.networkCalls = [];
    window.networkStatus = {supported:true,stage:options.external?'external':'off',profile:'alt13',external:options.external?'winws.exe':null};
    window.pywebview = {api:{
      load_state:async ()=>'{}',save_state:async ()=>true,
      desktop_network_status:async ()=>({...window.networkStatus}),
      desktop_network_start:async profile=>{
        window.networkCalls.push(['start',profile]);
        window.networkStatus = {supported:true,profile,stage:options.denied?'error':options.pending?'permission':'running',error:options.denied?'permission':''};
        return true;
      },
      desktop_network_stop:async ()=>{window.networkCalls.push(['stop']); window.networkStatus.stage='off';return true;},
    }};
  }, options);
  await page.goto(options.web ? '/?lang=ru' : '/?desktop=1&lang=ru');
  await page.locator('#themeButton').click();
}

test('network helper is opt-in and offers fixed profiles without enabling on launch', async ({page}) => {
  await openNetwork(page);
  await expect(page.locator('#desktopNetwork')).toBeVisible();
  await expect(page.locator('#desktopNetworkStatus')).toContainText('автоматически он не запускается');
  expect(await page.evaluate(()=>window.networkCalls)).toEqual([]);
  await page.locator('#desktopNetworkProfile').selectOption('alt11');
  await page.locator('#desktopNetworkEnable').click();
  await expect(page.locator('#desktopNetworkStatus')).toContainText('ALT11');
  await expect(page.locator('#desktopNetworkProfile')).toBeDisabled();
  await expect(page.locator('#desktopNetworkStop')).toBeVisible();
  await page.locator('#desktopNetworkStop').click();
  await expect(page.locator('#desktopNetworkStatus')).toContainText('Выключен');
  expect(await page.evaluate(()=>window.networkCalls)).toEqual([['start','alt11'],['stop']]);
});

test('external zapret prevents a second instance and its stop button is absent', async ({page}) => {
  await openNetwork(page,{external:true});
  await expect(page.locator('#desktopNetworkStatus')).toContainText('внешний zapret');
  await expect(page.locator('#desktopNetworkEnable')).toBeDisabled();
  await expect(page.locator('#desktopNetworkStop')).toBeHidden();
  expect(await page.evaluate(()=>window.networkCalls)).toEqual([]);
  await page.evaluate(()=>{window.networkStatus.stage='off'; window.networkStatus.external=null;});
  await expect(page.locator('#desktopNetworkEnable')).toBeEnabled();
});

test('declining Windows permission keeps the module off and allows retry', async ({page}) => {
  await openNetwork(page,{denied:true});
  await page.locator('#desktopNetworkEnable').click();
  await expect(page.locator('#desktopNetworkStatus')).toContainText('Разрешение администратора отклонено');
  await expect(page.locator('#desktopNetworkEnable')).toBeEnabled();
  await expect(page.locator('#desktopNetworkStop')).toBeHidden();
});

test('pending administrator approval can be cancelled through module controls', async ({page}) => {
  await openNetwork(page,{pending:true});
  await page.locator('#desktopNetworkEnable').click();
  await expect(page.locator('#desktopNetworkStatus')).toContainText('Ждём разрешение администратора');
  await page.locator('#desktopNetworkStop').click();
  await expect(page.locator('#desktopNetworkStatus')).toContainText('Выключен');
  expect(await page.evaluate(()=>window.networkCalls)).toEqual([['start','alt13'],['stop']]);
});

test('component verification failure and driver exit show distinct useful messages', async ({page}) => {
  await openNetwork(page);
  await page.evaluate(()=>{window.networkStatus.stage='error';window.networkStatus.error='component';});
  await expect(page.locator('#desktopNetworkStatus')).toContainText('не прошёл проверку');
  await page.evaluate(()=>{window.networkStatus.error='driver';});
  await expect(page.locator('#desktopNetworkStatus')).toContainText('WinDivert');
  await expect(page.locator('#desktopNetworkEnable')).toBeEnabled();
});

test('retry uses the active YouTube track and preserves its queue', async ({page}) => {
  await openNetwork(page);
  await page.locator('#themeClose').click();
  await searchFor(page,'midnight signal');
  await playSource(page,'youtube');
  await page.evaluate(()=>{
    const app=window.awunApp;
    window.networkRetryCalls=[];
    const original=app.playTrack;
    app.playTrack=(track,options)=>{window.networkRetryCalls.push({id:track.id,options});return original(track,options);};
    window.retryTrackId=app.state.active.id;
  });
  await page.locator('#themeButton').click();
  await page.locator('#desktopNetworkEnable').click();
  await expect(page.locator('#desktopNetworkRetry')).toBeVisible();
  await page.locator('#desktopNetworkRetry').click();
  const result=await page.evaluate(()=>({calls:window.networkRetryCalls,id:window.retryTrackId}));
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].id).toBe(result.id);
  expect(result.calls[0].options.preserveQueue).toBe(true);
  await expect(page.locator('#themePanel')).toBeHidden();
});

test('network settings fit narrow desktop windows and translate live', async ({page}) => {
  await page.setViewportSize({width:460,height:800});
  await openNetwork(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('#desktopNetwork details summary').click();
  await expect(page.locator('#desktopNetwork details')).toContainText('других приложениях Windows');
  await page.locator('#languageButton').click();
  await expect(page.locator('#desktopNetworkTitle')).toHaveText('YouTube access');
  await expect(page.locator('#desktopNetworkStatus')).toContainText('does not start automatically');
});

test('website never offers the native network helper', async ({page}) => {
  await openNetwork(page,{web:true});
  await expect(page.locator('#desktopNetwork')).toBeHidden();
  expect(await page.evaluate(()=>window.networkCalls)).toEqual([]);
});
