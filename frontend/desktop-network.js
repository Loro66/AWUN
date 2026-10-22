(() => {
  if (new URLSearchParams(location.search).get('desktop') !== '1') return;
  const app = window.awunApp, $ = id => document.getElementById(id), t = key => window.awunI18n.t(key);
  const api = () => window.pywebview?.api;
  const call = (name,...args) => window.awunDesktopCall(name,...args);
  let current = null, timer = null, changing = false;
  const busy = new Set(['preparing', 'permission', 'starting', 'stopping']);
  function render() {
    if (!current) return;
    $('desktopNetwork').hidden = !current.supported;
    if (!current.supported) return;
    const active = busy.has(current.stage) || current.stage === 'running';
    const errorKeys = {permission:'networkPermissionDenied',component:'networkComponentError',driver:'networkDriverError',timeout:'networkTimeout',session:'networkError',helper:'networkError'};
    const stageKeys = {off:'networkOff',preparing:'networkPreparing',permission:'networkPermission',starting:'networkStarting',running:'networkRunning',stopping:'networkStopping',external:'networkExternal'};
    $('desktopNetworkStatus').textContent = t(current.stage === 'error' ? errorKeys[current.error] || 'networkError' : stageKeys[current.stage] || 'networkError') + (current.stage === 'running' ? ` · ${current.profile === 'general' ? t('networkGeneral') : current.profile.toUpperCase()}` : '');
    $('desktopNetworkStatus').dataset.tone = current.stage === 'error' ? 'error' : current.stage === 'running' ? 'success' : 'notice';
    $('desktopNetworkEnable').hidden = active;
    $('desktopNetworkEnable').disabled = changing || current.stage === 'external';
    $('desktopNetworkStop').hidden = !active;
    $('desktopNetworkStop').disabled = changing || current.stage === 'stopping';
    $('desktopNetworkProfile').disabled = active || changing || current.stage === 'external';
    $('desktopNetworkRetry').hidden = !['running','external'].includes(current.stage) || app.state.active?.source !== 'youtube';
  }
  async function refresh() {
    clearTimeout(timer);
    if (!api()?.desktop_network_status) return;
    try { current = await call('desktop_network_status'); render(); }
    catch {
      if (current) { current = {...current, stage:'error', error:'helper'}; render(); }
    }
    if (current?.supported) timer = setTimeout(refresh, busy.has(current.stage) ? 300 : current.stage === 'running' ? 1000 : 2000);
  }
  $('desktopNetworkEnable').addEventListener('click', async () => {
    if (changing || !api()?.desktop_network_start) return;
    changing = true; render();
    try { await call('desktop_network_start',$('desktopNetworkProfile').value); }
    catch { current = {...current, stage:'error', error:'helper'}; }
    finally { changing = false; await refresh(); }
  });
  $('desktopNetworkStop').addEventListener('click', async () => {
    if (changing || !api()?.desktop_network_stop) return;
    changing = true; render();
    try { await call('desktop_network_stop'); }
    catch { current = {...current, stage:'error', error:'helper'}; }
    finally { changing = false; await refresh(); }
  });
  $('desktopNetworkRetry').addEventListener('click', () => {
    const track = app.state.active;
    if (track?.source !== 'youtube') return;
    $('themeClose').click();
    void app.playTrack(track, {preserveQueue:true, resumeAt:app.state.playbackPosition || 0});
  });
  window.addEventListener('pywebviewready', () => void refresh());
  document.addEventListener('awun:language', render);
  document.addEventListener('awun:track', render);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  if (api()?.desktop_network_status) void refresh();
})();
