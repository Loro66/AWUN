(function attachAwunRuntimeLog(root, factory) {
  const api = factory(root, root.awunStorage);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.awunRuntimeLog = api;
})(typeof globalThis === 'object' ? globalThis : this, function createAwunRuntimeLog(root, storage) {
  const LOG_KEY = 'awun-runtime-log-v1';
  const MAX_ENTRIES = 120;
  const SECRET_KEY = /(authorization|cookie|credential|key|password|secret|signature|token)/i;

  function safeString(value) {
    const text = String(value ?? '');
    try {
      const url = new URL(text);
      url.search = '';
      url.hash = '';
      return url.toString().slice(0, 300);
    } catch { return text.slice(0, 300); }
  }

  function sanitize(value, depth = 0) {
    if (depth > 3) return '[truncated]';
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return safeString(value);
    if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
    if (typeof value === 'object') {
      const output = {};
      Object.entries(value).slice(0, 30).forEach(([key, item]) => { output[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1); });
      return output;
    }
    return safeString(value);
  }

  function entries() {
    const value = storage?.readJSON?.(LOG_KEY, []);
    return Array.isArray(value) ? value.slice(-MAX_ENTRIES) : [];
  }

  function log(event, details = {}, level = 'info') {
    if (!event) return;
    const next = [...entries(), {
      at: new Date().toISOString(),
      level: ['info', 'warning', 'error'].includes(level) ? level : 'info',
      event: safeString(event),
      details: sanitize(details),
    }].slice(-MAX_ENTRIES);
    storage?.writeJSON?.(LOG_KEY, next, { backup: false });
  }

  function report(limit = 50) {
    return entries().slice(-Math.max(1, Math.min(MAX_ENTRIES, Number(limit) || 50)));
  }

  function download(filename = 'AWUN-runtime-log.json') {
    const blob = new Blob([JSON.stringify({ app: 'AWUN', created_at: new Date().toISOString(), entries: report() }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  if (root?.addEventListener) {
    root.addEventListener('error', event => log('window.error', { message: event.message, file: event.filename, line: event.lineno, column: event.colno }, 'error'));
    root.addEventListener('unhandledrejection', event => log('window.unhandledrejection', { message: event.reason?.message || event.reason }, 'error'));
    root.addEventListener('awun:storage-error', event => {
      if (event.detail?.key === LOG_KEY) return;
      log('storage.error', event.detail || {}, 'error');
    });
  }

  return { download, entries, log, report, sanitize };
});
