/* Exercise the packaged WebView2 application, not a browser mock. */
const { chromium, expect } = require('@playwright/test');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const net = require('node:net');

// The runner may use a proxy for public internet access; CDP stays on loopback.
process.env.NO_PROXY = [process.env.NO_PROXY,'127.0.0.1','localhost','[::1]'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

const executable = resolve(process.argv[2] || 'dist/SONGVALE.exe');
const output = resolve('test-results/windows-native');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'songvale-native-'));
mkdirSync(join(profile, 'SONGVALE'), { recursive: true });
writeFileSync(join(profile, 'SONGVALE', 'remote-api.txt'), 'local');
const report = { executable, started_at: new Date().toISOString(), checks: [] };
let child, browser, page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function launch() {
  const port = await freePort();
  child = spawn(executable, [], { env: { ...process.env, APPDATA: profile, LOCALAPPDATA: join(profile,'Local'), SONGVALE_DIAGNOSTIC_NO_DIALOG:'1', SONGVALE_TEST_CDP_PORT:String(port),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  }, stdio: 'ignore' });
  child.once('error', error => { report.launch_error = String(error); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application exited before WebView2 was ready: ${child.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; }
    catch (error) { report.cdp_error=String(error.message); await delay(250); }
  }
  if (!browser) throw new Error('The packaged application did not expose a WebView2 window');
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent('page', { timeout: 15_000 });
  page.on('pageerror', error => (report.javascript_errors ||= []).push(error.message));
  await page.waitForURL(url => url.hostname === '127.0.0.1' && url.searchParams.get('desktop') === '1', { timeout: 30_000 });
  await page.waitForFunction(() => window.awunApp && window.pywebview?.api?.desktop_status, { timeout: 20_000 });
  await expect(page.locator('#desktopMini')).toBeVisible({ timeout: 10_000 });
  return page;
}

async function check(name, work) {
  const started = Date.now();
  await work();
  report.checks.push({ name, status: 'passed', duration_ms: Date.now() - started });
  console.log(`PASS ${name}`);
}

async function cleanup() {
  try { execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('tests/windows/capture-desktop.ps1'),'-OutputDirectory',output],{stdio:'ignore',timeout:15000}); } catch {}
  try { report.processes = readFileSync(join(output,'processes.json'),'utf8');console.log(report.processes); } catch {}
  if (page) { try { await page.screenshot({ path: join(output, 'native-window.png') }); } catch {} }
  if (browser) { try { await browser.close(); } catch {} browser = null; }
  if (child && child.exitCode === null) {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
  try { report.saved_state = JSON.parse(readFileSync(join(profile, 'SONGVALE', 'desktop-state.json'), 'utf8')); } catch {}
  try { report.startup_log = readFileSync(join(profile,'Local','SONGVALE','logs','desktop.log'),'utf8').slice(-16000); console.log(report.startup_log); } catch {}
  report.finished_at = new Date().toISOString();
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
}

async function main() {
  await check('packaged WebView2 and native bridge become usable', launch);
  await check('native API promises resolve under the production CSP', async () => {
    const result = await page.evaluate(() => Promise.race([
      window.pywebview.api.desktop_status(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Native API did not reply')), 5000)),
    ]));
    expect(result.supported).toBe(true);
  });
  await check('native preferences and state writes complete', async () => {
    expect(await page.evaluate(() => window.pywebview.api.desktop_preferences(false, false))).toBe(true);
    expect(await page.evaluate(async () => {
      localStorage.setItem('awun-native-smoke', 'preserved');
      return window.awunDesktopFlush();
    })).toBe(true);
  });
  await page.screenshot({ path: join(output, 'native-ready.png') });
  report.status = 'passed';
}

const watchdog = setTimeout(() => {
  report.status = 'failed'; report.error = 'Native smoke exceeded its 180 second deadline';
  void cleanup().finally(() => process.exit(1));
}, 180_000);
main().catch(error => {
  report.status = 'failed'; report.error = String(error.stack || error);
  console.error(report.error); process.exitCode = 1;
}).finally(async () => { clearTimeout(watchdog); await cleanup(); });
