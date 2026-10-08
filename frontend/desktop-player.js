(() => {
  if (new URLSearchParams(location.search).get('desktop') !== '1') return;
  const app = window.awunApp, $ = id => document.getElementById(id), t = key => window.awunI18n.t(key);
  let native = null, mini = false, changing = false, updateTimer = null, installing = false;
  const api = () => window.pywebview?.api;
  function applyMode(enabled) {
    mini = enabled;
    document.body.classList.toggle('desktop-mini', mini);
    document.body.classList.toggle('desktop-mini-video', mini && app.state.active?.source === 'youtube');
    $('desktopMini').setAttribute('aria-pressed', String(mini));
    $('desktopMiniRestore').hidden = !mini;
    if (mini) {
      $('collapsePlayer').click();
      $('queueClose').click();
      $('themeClose').click();
      $('importClose').click();
      $('flowClose').click();
      app.ui.youtubeDock.classList.remove('minimized');
      $('desktopMiniRestore').focus();
    }
  }
  async function refresh() {
    if (!api()?.desktop_status) return;
    try {
      native = await api().desktop_status();
      const supported = Boolean(native.supported);
      document.body.classList.toggle('desktop-controls', supported);
      $('desktopSettings').hidden = !supported;
      $('desktopMini').hidden = !supported;
      $('desktopTray').hidden = !supported;
      $('desktopTray').disabled = !native.tray;
      $('desktopHotkeys').checked = Boolean(native.hotkeys);
      $('desktopCloseToTray').checked = Boolean(native.close_to_tray);
      $('desktopCloseToTray').disabled = !native.tray;
      const unavailable = (native.shortcuts || []).filter(item => native.hotkeys && !item.active);
      $('desktopStatus').textContent = !native.tray ? t('desktopTrayUnavailable') : unavailable.length ? `${t('desktopKeyConflict')} ${unavailable.map(item => item.keys).join(', ')}` : t('desktopReady');
      if (native.mini !== mini) applyMode(Boolean(native.mini));
    } catch { $('desktopStatus').textContent = t('desktopUnavailable'); }
  }
  async function setMini(enabled) {
    if (changing || !api()?.desktop_mini) return;
    changing = true;
    try {
      if (await api().desktop_mini(enabled, app.state.active?.source === 'youtube')) applyMode(enabled);
      else app.setMessage(t('desktopUnavailable'), 'error');
    } catch { app.setMessage(t('desktopUnavailable'), 'error'); }
    finally { changing = false; }
  }
  async function savePreferences() {
    try {
      if (!await api().desktop_preferences($('desktopHotkeys').checked, $('desktopCloseToTray').checked)) app.setMessage(t('storageSaveFailed'), 'error');
      await refresh();
      setTimeout(refresh, 200);
    } catch { app.setMessage(t('desktopUnavailable'), 'error'); }
  }
  function dispatch(action) {
    const buttons = { play_pause: 'playPause', previous: 'previousTrack', next: 'nextTrack' };
    if (buttons[action]) { if (app.state.active) $(buttons[action]).click(); }
    else if (action === 'mini') { void api()?.desktop_command('show'); void setMini(!mini); }
    else if (action === 'volume_up' || action === 'volume_down') {
      app.ui.volume.value = String(Math.max(0, Math.min(100, Number(app.ui.volume.value) + (action === 'volume_up' ? 5 : -5))));
      app.ui.volume.dispatchEvent(new Event('input'));
    } else if (action === 'status') void refresh();
  }
  $('desktopMini').addEventListener('click', () => void setMini(!mini));
  $('desktopMiniRestore').addEventListener('click', () => void setMini(false));
  $('desktopTray').addEventListener('click', () => void api()?.desktop_command('hide'));
  $('desktopQuit').addEventListener('click', () => void api()?.desktop_command('quit'));
  $('desktopHotkeys').addEventListener('change', savePreferences);
  $('desktopCloseToTray').addEventListener('change', savePreferences);
  async function pollUpdate() {
    try {
      const result = await api().desktop_update_status();
      const keys = {checking:'updateCheckingNative',downloading:'updateDownloadingNative',verifying:'updateVerifyingNative',ready:'updateVerifyingNative',installing:'updateInstallingNative',current:'updateCurrentNative',error:'updateErrorNative'};
      $('desktopUpdateStatus').textContent = t(keys[result.stage] || 'updateCheckingNative');
      $('desktopUpdateProgress').hidden = !['downloading','verifying'].includes(result.stage);
      $('desktopUpdateProgress').value = result.progress || 0;
      if (result.stage === 'ready' && !installing) {
        installing = true;
        app.persistPlaybackSession();
        if (!await window.awunDesktopFlush?.()) throw new Error('State not saved');
        if (!await api().desktop_update_install()) throw new Error('Installer not started');
        $('desktopUpdateStatus').textContent = t('updateInstallingNative');
        return;
      }
      if (['current','error','idle'].includes(result.stage)) { $('desktopUpdate').disabled = false; return; }
      updateTimer = setTimeout(pollUpdate, 500);
    } catch { $('desktopUpdateStatus').textContent = t('updateErrorNative'); $('desktopUpdate').disabled = false; installing = false; }
  }
  $('desktopUpdate').addEventListener('click', async () => {
    $('desktopUpdate').disabled = true; installing = false; clearTimeout(updateTimer);
    $('desktopUpdateStatus').textContent = t('updateCheckingNative');
    try { await api().desktop_update(); void pollUpdate(); }
    catch { $('desktopUpdateStatus').textContent = t('updateErrorNative'); $('desktopUpdate').disabled = false; }
  });
  window.addEventListener('songvale:desktop-command', event => dispatch(event.detail?.action));
  window.addEventListener('pywebviewready', () => { void refresh(); setTimeout(refresh, 500); });
  document.addEventListener('awun:language', () => void refresh());
  document.addEventListener('awun:track', () => {
    if (mini) {
      document.body.classList.toggle('desktop-mini-video', app.state.active?.source === 'youtube');
      app.ui.youtubeDock.classList.remove('minimized');
      void api()?.desktop_mini(true, app.state.active?.source === 'youtube');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mini) { event.preventDefault(); void setMini(false); }
  });
  if (api()?.desktop_status) void refresh();
})();
