/* Validate the packaged WebView2 application with real native storage and audio. */
const {chromium,expect}=require('@playwright/test');
const {spawn,execFileSync}=require('node:child_process');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {resolve,join}=require('node:path');
const net=require('node:net');

process.env.NO_PROXY=[process.env.NO_PROXY,'127.0.0.1','localhost','[::1]'].filter(Boolean).join(',');
process.env.no_proxy=process.env.NO_PROXY;
const executable=resolve(process.argv[2]||'dist/SONGVALE.exe'),output=resolve('test-results/windows-native');
mkdirSync(output,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),'songvale-native-'));
mkdirSync(join(profile,'SONGVALE'),{recursive:true});
writeFileSync(join(profile,'SONGVALE','remote-api.txt'),'local');
const report={executable,started_at:new Date().toISOString(),checks:[]},children=new Set();
let child,browser,page,launchEnvironment;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));return port;
}
async function launch(){
  const port=await freePort();
  launchEnvironment={...process.env,APPDATA:profile,LOCALAPPDATA:join(profile,'Local'),
    SONGVALE_DIAGNOSTIC_NO_DIALOG:'1',SONGVALE_TEST_CDP_PORT:String(port),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+port};
  child=spawn(executable,[],{env:launchEnvironment,stdio:'ignore'});children.add(child);
  child.once('error',error=>{report.launch_error=String(error);});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error('Application exited before its window was ready: '+child.exitCode);
    try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:1000});break;}
    catch(error){report.cdp_error=String(error.message);await delay(250);}
  }
  if(!browser)throw new Error('The application did not expose its WebView2 window');
  const context=browser.contexts()[0];
  page=context.pages()[0]||await context.waitForEvent('page',{timeout:15000});
  page.on('pageerror',error=>(report.javascript_errors||=[]).push(error.message));
  page.on('console',message=>{
    if(message.type()==='error'&&(report.console_errors||=[]).length<30)report.console_errors.push(message.text().slice(0,500));
  });
  await page.waitForURL(url=>url.hostname==='127.0.0.1'&&url.searchParams.get('desktop')==='1',{timeout:30000});
  await page.waitForFunction(()=>window.awunApp&&window.pywebview?.api?.desktop_status,null,{timeout:20000});
  await expect(page.locator('html')).not.toHaveClass(/desktop-restoring/,{timeout:20000});
  report.engine=await browser.version();
  report.viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,screenWidth:screen.availWidth,screenHeight:screen.availHeight}));
}
async function check(name,work){
  const start=Date.now();await work();
  report.checks.push({name,status:'passed',duration_ms:Date.now()-start});
  console.log('PASS '+name);
}
function wave(frequency){
  const rate=8000,seconds=40,data=Buffer.alloc(44+rate*seconds*2);
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);
  data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);
  data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);
  for(let i=0;i<rate*seconds;i++)data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*frequency/rate)*1500),44+i*2);
  return data;
}
async function waitForExit(process,timeout=20000){
  const end=Date.now()+timeout;
  while(process.exitCode===null&&Date.now()<end)await delay(100);
  if(process.exitCode===null)throw new Error('Application did not exit after saving');
  expect(process.exitCode).toBe(0);
}
async function quit(){
  try{await page.evaluate(()=>window.pywebview.api.desktop_command('quit'));}
  catch(error){if(!/closed|destroyed/i.test(error.message))throw error;}
  await waitForExit(child);browser=null;page=null;
}
async function preview(name){
  const bytes=await page.screenshot({type:'jpeg',quality:65,timeout:5000});
  writeFileSync(join(output,name+'.jpg'),bytes);
  // A small native UI preview remains readable even when only CI log access is available.
  console.log('SONGVALE_UI_JPEG:'+bytes.toString('base64'));
}
async function cleanup(){
  try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('tests/windows/capture-desktop.ps1'),'-OutputDirectory',output],{stdio:'ignore',timeout:15000});}catch{}
  if(page){
    try { report.native_status=await page.evaluate(()=>Promise.race([window.pywebview.api.desktop_status(),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),2000))])); } catch {}
    try { await preview('native-final'); } catch {}
    try{report.ui=await page.evaluate(()=>({url:location.href,classes:document.body.className,notice:document.getElementById('desktopStorageNotice')?.textContent}));}catch{}
    try{await page.screenshot({path:join(output,'native-window.png'),timeout:5000});}catch{}
  }
  if(browser){try{await Promise.race([browser.close(),delay(5000)]);}catch{}browser=null;}
  for(const process of children)if(process.exitCode===null){
    try{execFileSync('taskkill',['/PID',String(process.pid),'/T','/F'],{stdio:'ignore',timeout:10000});}catch{}
  }
  try{report.processes=readFileSync(join(output,'processes.json'),'utf8');console.log(report.processes);}catch{}
  try{report.saved_state=JSON.parse(readFileSync(join(profile,'SONGVALE','desktop-state.json'),'utf8'));}catch{}
  try{report.startup_log=readFileSync(join(profile,'Local','SONGVALE','logs','desktop.log'),'utf8').slice(-16000);console.log(report.startup_log);}catch{}
  report.finished_at=new Date().toISOString();writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
}
async function main(){
  await check('packaged WebView2 starts in the visible work area',launch);
  await check('native API promises and desktop controls respond under the production CSP',async()=>{
    const status=await page.evaluate(()=>Promise.race([
      window.pywebview.api.desktop_status(),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Native API did not reply')),5000)),
    ]));
    expect(status.supported).toBe(true);
    await expect(page.locator('body')).toHaveClass(/desktop-controls/);
    expect(report.viewport.width).toBeLessThanOrEqual(report.viewport.screenWidth);
    expect(report.viewport.height).toBeLessThanOrEqual(report.viewport.screenHeight);
    expect(await page.evaluate(()=>window.pywebview.api.desktop_preferences(false,false))).toBe(true);
    expect(await page.evaluate(async()=>{localStorage.setItem('awun-native-smoke','preserved');return window.awunDesktopFlush();})).toBe(true);
  });
  await check('two real WAV files import into native storage and play',async()=>{
    await page.locator('#localAudioInput').setInputFiles([
      {name:'Native One.wav',mimeType:'audio/wav',buffer:wave(220)},
      {name:'Native Two.wav',mimeType:'audio/wav',buffer:wave(330)},
    ]);
    await expect(page.locator('.collection-track')).toHaveCount(2,{timeout:15000});
    await page.locator('.collection-play').first().click();
    await page.waitForFunction(()=>window.awunApp.state.isPlaying&&window.awunApp.ui.audio.currentTime>.2,null,{timeout:15000});
    expect(await page.evaluate(()=>window.awunApp.state.active.source)).toBe('local');
    await preview('native-playing');
  });
  await check('mini player preserves playback and restores the full window',async()=>{
    const generation=await page.evaluate(()=>window.awunApp.state.playbackGeneration);
    await page.locator('#desktopMini').click();await expect(page.locator('body')).toHaveClass(/desktop-mini/);
    await expect(page.locator('#desktopMiniRestore')).toBeVisible();
    expect(await page.evaluate(()=>window.awunApp.state.playbackGeneration)).toBe(generation);
    await page.screenshot({path:join(output,'native-mini.png'),timeout:5000});
    await page.locator('#desktopMiniRestore').click();await expect(page.locator('body')).not.toHaveClass(/desktop-mini/);
  });
  await check('tray audio continues and duplicate launch reuses the running player',async()=>{
    const before=await page.evaluate(()=>window.awunApp.ui.audio.currentTime);
    await page.evaluate(()=>window.pywebview.api.desktop_command('hide'));
    await page.waitForFunction(position=>window.awunApp.ui.audio.currentTime>position+.2,before,{timeout:10000});
    const duplicate=spawn(executable,[],{env:launchEnvironment,stdio:'ignore'});children.add(duplicate);
    await waitForExit(duplicate,15000);expect(child.exitCode).toBe(null);
    expect(await page.evaluate(()=>window.pywebview.api.desktop_status())).toMatchObject({supported:true});
  });
  await check('prepared native audio advances through a real crossfade',async()=>{
    await page.evaluate(()=>{
      const app=window.awunApp,files=window.SongvaleCollections.local.tracks;
      window.SongvaleContinuous.settings.preload=true;window.SongvaleContinuous.settings.crossfade=2;
      app.replaceQueue([files[1]],'manual');
    });
    await page.waitForFunction(()=>window.SongvaleContinuous.state().status==='ready',null,{timeout:15000});
    await page.evaluate(()=>window.awunApp.ui.audio.currentTime=38.5);
    await page.waitForFunction(()=>window.awunApp.state.active?.title==='Native Two'&&window.awunApp.state.isPlaying,null,{timeout:15000});
    await page.waitForFunction(()=>window.awunApp.ui.audio.currentTime>.1,null,{timeout:10000});
  });
  let expected;
  await check('quit flushes Unicode library, queue, position, mute and language',async()=>{
    await page.evaluate(async()=>{
      const app=window.awunApp,files=window.SongvaleCollections.local.tracks;
      await app.playTrack(files[0]);app.replaceQueue([files[1]],'manual');
      app.ui.audio.currentTime=13;app.pausePlayback();
      app.ui.volume.value='23';app.ui.volume.dispatchEvent(new Event('input'));document.getElementById('muteButton').click();
      window.awunI18n.setLanguage('ru');
      app.toggleSave({id:'audius_native_saved',source:'audius',title:'Сохранённая музыка',artist:'Проверка',duration:40,stream_url:''});
      window.awunStorage.writeJSON('songvale-transitions-v1',window.SongvaleContinuous.settings);
    });
    expected=await page.evaluate(()=>({active:window.awunApp.state.active.id,next:window.awunApp.state.queue[0].id}));
    await page.screenshot({path:join(output,'native-before-restart.png'),timeout:5000});
    await quit();
    const saved=JSON.parse(readFileSync(join(profile,'SONGVALE','desktop-state.json'),'utf8'));
    expect(saved['awun-library']).toContain('Сохранённая музыка');
    expect(JSON.parse(saved['awun-volume-v1']).value).toBe(0);expect(saved['awun-language']).toBe('ru');
    expect(JSON.stringify(saved)).not.toContain('token=');
  });
  await check('cold restart restores files and resumes with this launch token',async()=>{
    await launch();
    await page.waitForFunction(()=>window.SongvaleCollections?.local?.tracks?.length===2,null,{timeout:15000});
    expect(await page.evaluate(()=>({active:window.awunApp.state.active?.id,next:window.awunApp.state.queue[0]?.id}))).toEqual(expected);
    expect(await page.evaluate(()=>window.awunApp.state.isPlaying)).toBe(false);
    expect(await page.evaluate(()=>window.awunI18n.language)).toBe('ru');
    await expect(page.locator('#volume')).toHaveValue('0');await page.locator('#muteButton').click();
    await expect(page.locator('#volume')).toHaveValue('23');await page.locator('#playPause').click();
    await page.waitForFunction(()=>window.awunApp.state.isPlaying&&window.awunApp.ui.audio.currentTime>=12,null,{timeout:15000});
    await page.locator('#themeButton').click();await expect(page.locator('#desktopSettings')).toBeVisible();
    await preview('native-restored-settings');await quit();
  });
  report.status='passed';
}
const watchdog=setTimeout(()=>{
  report.status='failed';report.error='Native smoke exceeded its 240 second deadline';
  void cleanup().finally(()=>process.exit(1));
},240000);
main().catch(error=>{
  report.status='failed';report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;
}).finally(async()=>{clearTimeout(watchdog);await cleanup();});
