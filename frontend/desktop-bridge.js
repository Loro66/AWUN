(() => {
  if (new URLSearchParams(location.search).get('desktop') !== '1') return;
  const transient = new Set(['awun-waveforms-v1','awun-search-cache-v1','awun-runtime-log-v1','awun-catalog-cache-v1']);
  const persistent = key => typeof key === 'string' && (
    key.startsWith('awun-') && !transient.has(key) ||
    ['songvale-account-owner-v1','songvale-backup-restore-pending-v1','songvale-source-preferences-v1','songvale-transitions-v1'].includes(key) ||
    key.startsWith('songvale-account-sync-')
  );
  const original = {set:Storage.prototype.setItem,remove:Storage.prototype.removeItem,clear:Storage.prototype.clear};
  const fallback = {
    desktopRestoring:'Восстанавливаем медиатеку…',
    desktopRestoreFailed:'Не удалось восстановить медиатеку. Файлы сохранены; повтори попытку. Новые данные пока не записываются поверх старых.',
    desktopSaveFailed:'Последние изменения не записались на диск. Оставь приложение открытым и повтори сохранение.',
    desktopRecovered:'Медиатека восстановлена из последней рабочей копии.',
    desktopRetry:'Повторить',
  };
  let ready = false, restoring = false, initializing = null, syncTimer, notice = null, lastSaved = null;
  let saveTail = Promise.resolve(true);

  function showNotice(key, tone = 'notice') {
    notice = key ? {key,tone} : null;
    const box = document.getElementById('desktopStorageNotice');
    if (!box) return;
    box.hidden = !notice;
    if (!notice) return;
    box.dataset.tone = tone;
    const translate = name => window.awunI18n?.t(name) || fallback[name];
    document.getElementById('desktopStorageMessage').textContent = translate(key);
    const retry = document.getElementById('desktopStorageRetry');
    retry.textContent = translate('desktopRetry');
    retry.hidden = tone !== 'error';
  }

  async function nativeCall(method, ...args) {
    const fn = window.pywebview?.api?.[method];
    if (!fn) throw new Error('Native API unavailable');
    let timer;
    try {
      return await Promise.race([
        fn(...args),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native API timed out')), 12_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  window.awunDesktopCall = nativeCall;

  function snapshot() {
    const state = {};
    for (let i=0;i<localStorage.length;i++) {
      const key = localStorage.key(i);
      if (persistent(key)) state[key] = localStorage.getItem(key);
    }
    return state;
  }
  function saveError(error) {
    showNotice('desktopSaveFailed','error');
    window.dispatchEvent(new CustomEvent('awun:storage-error',{detail:{operation:'desktop-sync',key:'desktop-state.json',message:String(error?.message || error),at:new Date().toISOString()}}));
  }
  window.awunDesktopStorageError = saveError;

  function queueSave() {
    // One native write at a time: an older callback cannot overwrite a later snapshot.
    saveTail = saveTail.catch(() => false).then(async () => {
      if (!ready || restoring) return false;
      try {
        const payload = JSON.stringify(snapshot());
        if (payload === lastSaved) return true;
        if (!await nativeCall('save_state',payload)) throw new Error('Desktop state was not saved');
        lastSaved = payload;
        if (notice?.tone === 'error') showNotice(null);
        return true;
      } catch (error) { saveError(error); return false; }
    });
    return saveTail;
  }
  window.awunDesktopFlush = async () => {
    clearTimeout(syncTimer);
    if (!ready && !await initialize()) return false;
    return queueSave();
  };
  function scheduleSync() {
    if (!ready || restoring) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(queueSave,180);
  }
  Storage.prototype.setItem = function(key,value) {
    original.set.call(this,key,value);
    if (this === localStorage && persistent(String(key))) scheduleSync();
  };
  Storage.prototype.removeItem = function(key) {
    original.remove.call(this,key);
    if (this === localStorage && persistent(String(key))) scheduleSync();
  };
  Storage.prototype.clear = function() {
    original.clear.call(this);
    if (this === localStorage) scheduleSync();
  };

  async function initialize() {
    if (ready) return true;
    if (initializing) return initializing;
    if (!window.pywebview?.api?.load_state) return false;
    initializing = (async () => {
      try {
        restoring = true;
        const saved = JSON.parse(await nativeCall('load_state') || '{}');
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid desktop snapshot');
        const entries = Object.entries(saved).filter(([key]) => persistent(key));
        if (entries.some(([,value]) => typeof value !== 'string')) throw new Error('Invalid desktop storage value');
        if (!sessionStorage.getItem('awun-desktop-restored')) {
          const changed = entries.some(([key,value]) => localStorage.getItem(key) !== value);
          entries.forEach(([key,value]) => original.set.call(localStorage,key,value));
          original.set.call(sessionStorage,'awun-desktop-restored','1');
          if (changed) { location.reload(); return false; }
        }
        ready = true; restoring = false;
        document.documentElement.classList.remove('desktop-restoring');
        showNotice(null);
        if (window.pywebview.api.desktop_storage_status) {
          const status = await nativeCall('desktop_storage_status');
          if (status.recovered) showNotice('desktopRecovered','success');
        }
        if (window.pywebview.api.desktop_frontend_ready) void nativeCall('desktop_frontend_ready').catch(saveError);
        scheduleSync();
        window.dispatchEvent(new Event('awun:desktop-ready'));
        return true;
      } catch (error) {
        ready = false; restoring = false;
        document.documentElement.classList.remove('desktop-restoring');
        showNotice('desktopRestoreFailed','error');
        return false;
      } finally { initializing = null; }
    })();
    return initializing;
  }
  document.documentElement.classList.add('desktop-restoring');
  const startupTimer = setTimeout(() => {
    if (!ready) { document.documentElement.classList.remove('desktop-restoring');showNotice('desktopRestoreFailed','error'); }
  },15_000);
  window.addEventListener('awun:desktop-ready',() => clearTimeout(startupTimer),{once:true});
  window.addEventListener('pywebviewready',() => { void initialize(); });
  document.addEventListener('awun:language',() => { if (notice) showNotice(notice.key,notice.tone); });
  document.addEventListener('DOMContentLoaded',() => {
    if (notice) showNotice(notice.key,notice.tone);
    document.getElementById('desktopStorageRetry')?.addEventListener('click',async () => {
      if (ready) await window.awunDesktopFlush();
      else { showNotice('desktopRestoring'); await initialize(); }
    });
  });
  if (window.pywebview?.api?.load_state) void initialize();
})();
