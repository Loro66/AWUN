(function attachAwunStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.awunStorage = api;
})(typeof globalThis === 'object' ? globalThis : this, function createAwunStorage(root) {
  const PREFIX = 'awun-';
  const SCHEMA_VERSION = 2;
  const META_KEY = 'awun-storage-meta-v2';
  const BACKUP_DATABASE = 'awun-local-backups';
  const BACKUP_STORE = 'snapshots';
  const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
  const EXCLUDED_BACKUP_KEYS = new Set(['awun-runtime-log-v1', 'awun-waveforms-v1']);
  let lastError = null;
  let backupTimer = null;

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function storage() {
    return root?.localStorage || null;
  }

  function reportError(operation, key, error) {
    lastError = {
      operation,
      key: String(key || ''),
      message: String(error?.message || error || 'storage failure').slice(0, 240),
      at: new Date().toISOString(),
    };
    try {
      root?.dispatchEvent?.(new CustomEvent('awun:storage-error', { detail: lastError }));
    } catch {}
    return false;
  }

  function readText(key, fallback = null) {
    try {
      const value = storage()?.getItem(String(key));
      return value === null ? fallback : value;
    } catch (error) {
      reportError('read', key, error);
      return fallback;
    }
  }

  function writeText(key, value, { backup = true } = {}) {
    try {
      const target = storage();
      if (!target) throw new Error('Local storage unavailable');
      target.setItem(String(key), String(value));
      if (backup && !EXCLUDED_BACKUP_KEYS.has(String(key))) scheduleBackup();
      return true;
    } catch (error) {
      return reportError('write', key, error);
    }
  }

  function readJSON(key, fallback) {
    const raw = readText(key, null);
    if (raw === null) return clone(fallback);
    try { return JSON.parse(raw); }
    catch (error) {
      reportError('parse', key, error);
      return clone(fallback);
    }
  }

  function writeJSON(key, value, options) {
    try { return writeText(key, JSON.stringify(value), options); }
    catch (error) { return reportError('serialize', key, error); }
  }

  function remove(key) {
    try {
      const target = storage();
      if (!target) throw new Error('Local storage unavailable');
      target.removeItem(String(key));
      scheduleBackup();
      return true;
    }
    catch (error) { return reportError('remove', key, error); }
  }

  function snapshot() {
    const data = {};
    try {
      const target = storage();
      if (!target) return data;
      for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (!key?.startsWith(PREFIX) || EXCLUDED_BACKUP_KEYS.has(key)) continue;
        const value = target.getItem(key);
        if (value !== null) data[key] = value;
      }
    } catch (error) { reportError('snapshot', '', error); }
    return data;
  }

  function openBackupDatabase() {
    return new Promise((resolve, reject) => {
      if (!root?.indexedDB) { resolve(null); return; }
      const request = root.indexedDB.open(BACKUP_DATABASE, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BACKUP_STORE)) database.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
  }

  async function backupNow() {
    backupTimer = null;
    try {
      const database = await openBackupDatabase();
      if (!database) return false;
      const payload = { id: 'latest', schema: SCHEMA_VERSION, saved_at: new Date().toISOString(), data: snapshot() };
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(BACKUP_STORE, 'readwrite');
        transaction.objectStore(BACKUP_STORE).put(payload);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Backup failed'));
        transaction.onabort = () => reject(transaction.error || new Error('Backup aborted'));
      });
      database.close();
      return true;
    } catch (error) { return reportError('backup', BACKUP_DATABASE, error); }
  }

  function scheduleBackup() {
    if (!root?.indexedDB || backupTimer) return;
    backupTimer = root.setTimeout(() => { void backupNow(); }, 600);
  }

  async function latestBackup() {
    try {
      const database = await openBackupDatabase();
      if (!database) return null;
      const payload = await new Promise((resolve, reject) => {
        const request = database.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).get('latest');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Backup read failed'));
      });
      database.close();
      return payload;
    } catch (error) { reportError('backup-read', BACKUP_DATABASE, error); return null; }
  }

  function validateImport(value) {
    const envelope = typeof value === 'string' ? JSON.parse(value) : value;
    if (!envelope || envelope.app !== 'AWUN' || !envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
      throw new Error('Invalid AWUN backup');
    }
    const entries = Object.entries(envelope.data).filter(([key]) => key.startsWith(PREFIX));
    const bytes = entries.reduce((total, [key, value]) => total + new TextEncoder().encode(`${key}${String(value)}`).length, 0);
    if (bytes > MAX_IMPORT_BYTES) throw new Error('AWUN backup is too large');
    return entries.map(([key, value]) => [key, String(value)]);
  }

  async function importState(value) {
    let entries;
    try { entries = validateImport(value); }
    catch (error) { reportError('import-validate', '', error); throw error; }
    await backupNow();
    const previous = snapshot();
    try {
      const target = storage();
      if (!target) throw new Error('Local storage unavailable');
      Object.keys(previous).forEach(key => target.removeItem(key));
      entries.forEach(([key, raw]) => target.setItem(key, raw));
      migrate();
      scheduleBackup();
      try { root?.dispatchEvent?.(new CustomEvent('awun:storage-restored')); } catch {}
      return true;
    } catch (error) {
      try {
        const target = storage();
        entries.forEach(([key]) => target?.removeItem(key));
        Object.entries(previous).forEach(([key, raw]) => target?.setItem(key, raw));
      } catch {}
      reportError('import', '', error);
      throw error;
    }
  }

  async function restoreLatestBackup() {
    const backup = await latestBackup();
    if (!backup?.data) return false;
    return importState({ app: 'AWUN', schema: backup.schema || SCHEMA_VERSION, data: backup.data });
  }

  function exportState() {
    return JSON.stringify({
      app: 'AWUN',
      schema: SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      data: snapshot(),
    }, null, 2);
  }

  function download(filename = 'AWUN-backup.json') {
    const blob = new Blob([exportState()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function migrate() {
    const meta = readJSON(META_KEY, { schema: 0 });
    if ((Number(meta?.schema) || 0) >= SCHEMA_VERSION) { scheduleBackup(); return; }
    const queue = readJSON('awun-queue-v1', null);
    if (Array.isArray(queue)) writeJSON('awun-queue-v1', { version: 1, mode: 'manual', items: queue }, { backup: false });
    if (readText('awun-wave-profile-v2', null) === null) {
      const legacyProfile = readText('awun-flow-profile-v1', null);
      if (legacyProfile !== null) writeText('awun-wave-profile-v2', legacyProfile, { backup: false });
    }
    writeJSON(META_KEY, { schema: SCHEMA_VERSION, migrated_at: new Date().toISOString() }, { backup: false });
    scheduleBackup();
  }

  function info() {
    const data = snapshot();
    const bytes = Object.entries(data).reduce((total, [key, value]) => total + new TextEncoder().encode(`${key}${value}`).length, 0);
    return { schema: SCHEMA_VERSION, bytes, keys: Object.keys(data).length, last_error: lastError };
  }

  return {
    SCHEMA_VERSION,
    backupNow,
    download,
    exportState,
    importState,
    info,
    latestBackup,
    migrate,
    readJSON,
    readText,
    remove,
    restoreLatestBackup,
    snapshot,
    writeJSON,
    writeText,
  };
});
