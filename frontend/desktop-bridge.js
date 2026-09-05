(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('desktop') !== '1') return;

  let bridgeReady = false;
  let restoring = false;
  let syncTimer = null;
  const transientKeys = new Set(['awun-waveforms-v1']);
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  function snapshot() {
    const state = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('awun-') && !transientKeys.has(key)) state[key] = localStorage.getItem(key);
    }
    return state;
  }

  function scheduleSync() {
    if (!bridgeReady || restoring) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      window.pywebview?.api?.save_state(JSON.stringify(snapshot())).then(saved => {
        if (saved) return;
        window.dispatchEvent(new CustomEvent('awun:storage-error', { detail: { operation: 'desktop-sync', key: 'desktop-state.json', message: 'Desktop state was not saved', at: new Date().toISOString() } }));
      }).catch(error => window.dispatchEvent(new CustomEvent('awun:storage-error', { detail: { operation: 'desktop-sync', key: 'desktop-state.json', message: String(error?.message || error), at: new Date().toISOString() } })));
    }, 180);
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
  });
})();
