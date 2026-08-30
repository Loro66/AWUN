(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('desktop') !== '1') return;

  let bridgeReady = false;
  let restoring = false;
  let syncTimer = null;
  let compatButton = null;
  let compatLabel = null;
  let compatBusy = false;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  function snapshot() {
    const state = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('awun-')) state[key] = localStorage.getItem(key);
    }
    return state;
  }

  function scheduleSync() {
    if (!bridgeReady || restoring) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      window.pywebview?.api?.save_state(JSON.stringify(snapshot())).catch(() => {});
    }, 180);
  }

  function isRussian() {
    return (document.documentElement.lang || 'ru').toLowerCase().startsWith('ru');
  }

  function ensureCompatButton() {
    if (compatButton) return compatButton;
    const actions = document.querySelector('.top-actions');
    if (!actions) return null;

    compatButton = document.createElement('button');
    compatButton.type = 'button';
    compatButton.className = 'library desktop-compat-button';
    compatButton.title = isRussian()
      ? 'Опциональный обход DPI только для SoundCloud и YouTube. Не меняет IP-адрес.'
      : 'Optional DPI compatibility for SoundCloud and YouTube only. Does not change your IP address.';

    const icon = document.createElement('i');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'SC';
    const text = document.createElement('span');
    text.textContent = isRussian() ? 'СОВМЕСТИМОСТЬ' : 'COMPATIBILITY';
    compatLabel = document.createElement('b');
    compatLabel.textContent = '...';
    compatButton.append(icon, text, compatLabel);

    const themeButton = document.getElementById('themeButton');
    actions.insertBefore(compatButton, themeButton || null);
    compatButton.addEventListener('click', toggleRegionalCompat);
    return compatButton;
  }

  function renderCompatStatus(status) {
    ensureCompatButton();
    if (!compatButton || !compatLabel) return;
    compatButton.disabled = compatBusy || status?.supported === false;
    compatButton.classList.toggle('on', Boolean(status?.running));

    if (compatBusy) compatLabel.textContent = '...';
    else if (status?.running) compatLabel.textContent = isRussian() ? 'ВКЛ' : 'ON';
    else if (status?.external_zapret_running) compatLabel.textContent = 'ZAPRET';
    else compatLabel.textContent = isRussian() ? 'ВЫКЛ' : 'OFF';
  }

  async function refreshRegionalCompat() {
    if (!bridgeReady || !window.pywebview?.api?.regional_compat_status) return;
    ensureCompatButton();
    try {
      renderCompatStatus(await window.pywebview.api.regional_compat_status());
    } catch {
      if (compatLabel) compatLabel.textContent = 'ERR';
    }
  }

  async function toggleRegionalCompat() {
    if (compatBusy || !bridgeReady) return;
    compatBusy = true;
    renderCompatStatus({});
    try {
      const status = await window.pywebview.api.regional_compat_status();
      if (!status.running) {
        const warning = isRussian()
          ? 'AWUN скачает актуальный Flowseal, проверит SHA256 и установит Windows-службу WinDivert/winws только для SoundCloud и YouTube. Появится запрос UAC. Это не VPN и внешний IP не изменится. Продолжить?'
          : 'AWUN will download the current Flowseal release, verify its SHA256 and install a WinDivert/winws Windows service scoped to SoundCloud and YouTube. Windows will show a UAC prompt. This is not a VPN and your public IP will not change. Continue?';
        if (!window.confirm(warning)) return;
      }
      const result = status.running
        ? await window.pywebview.api.disable_regional_compat()
        : await window.pywebview.api.enable_regional_compat();
      if (!result?.ok) {
        window.alert(result?.error || (isRussian() ? 'Не удалось изменить режим совместимости.' : 'Could not change compatibility mode.'));
      }
    } catch (error) {
      window.alert(error?.message || String(error));
    } finally {
      compatBusy = false;
      await refreshRegionalCompat();
    }
  }

  Storage.prototype.setItem = function setItem(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && String(key).startsWith('awun-')) scheduleSync();
  };
  Storage.prototype.removeItem = function removeItem(key) {
    originalRemoveItem.call(this, key);
    if (this === localStorage && String(key).startsWith('awun-')) scheduleSync();
  };
  Storage.prototype.clear = function clear() {
    originalClear.call(this);
    if (this === localStorage) scheduleSync();
  };

  window.addEventListener('pywebviewready', async () => {
    bridgeReady = true;
    try {
      const raw = await window.pywebview.api.load_state();
      const saved = JSON.parse(raw || '{}');
      if (saved && typeof saved === 'object' && !sessionStorage.getItem('awun-desktop-restored')) {
        restoring = true;
        Object.entries(saved).forEach(([key, value]) => {
          if (key.startsWith('awun-')) originalSetItem.call(localStorage, key, String(value));
        });
        originalSetItem.call(sessionStorage, 'awun-desktop-restored', '1');
        restoring = false;
        location.reload();
        return;
      }
    } catch {
      restoring = false;
    }
    scheduleSync();
    await refreshRegionalCompat();
  });
})();