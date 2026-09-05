(function attachAwunUpdateChecker(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.awunUpdateChecker = api;
})(typeof globalThis === 'object' ? globalThis : this, function createAwunUpdateChecker(root) {
  const RELEASE_API = 'https://api.github.com/repos/Loro66/AWUN/releases/latest';
  const RELEASE_PAGE = 'https://github.com/Loro66/AWUN/releases';
  const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

  function parts(version) {
    const match = String(version || '').match(VERSION_PATTERN);
    if (!match) throw new Error('Invalid release version');
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ''];
  }

  function compare(left, right) {
    const first = parts(left), second = parts(right);
    for (let index = 0; index < 3; index += 1) {
      if (first[index] !== second[index]) return first[index] > second[index] ? 1 : -1;
    }
    if (first[3] === second[3]) return 0;
    if (!first[3] || !second[3]) return first[3] ? -1 : 1;
    const leftTags = first[3].split('.'), rightTags = second[3].split('.');
    for (let index = 0; index < Math.max(leftTags.length, rightTags.length); index += 1) {
      const a = leftTags[index], b = rightTags[index];
      if (a === b) continue;
      if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
      const aNumeric = /^\d+$/.test(a), bNumeric = /^\d+$/.test(b);
      if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1;
      if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
      return a > b ? 1 : -1;
    }
    return 0;
  }

  function releaseUrl(value) {
    try {
      const url = new URL(value);
      if (url.origin === 'https://github.com' && !url.username && !url.password &&
          (url.pathname === '/Loro66/AWUN/releases' || url.pathname.startsWith('/Loro66/AWUN/releases/'))) return url.href;
    } catch {}
    return RELEASE_PAGE;
  }

  async function check(currentVersion, fetcher = root.fetch.bind(root), { timeoutMs = 12_000 } = {}) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = root.setTimeout(() => {
        const error = new Error('Update check timed out');
        error.code = 'UPDATE_TIMEOUT';
        reject(error);
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetcher(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: controller.signal });
        if (response.status === 404) return { status: 'no-release', current: currentVersion, available: false };
        if (!response.ok) throw new Error(`GitHub Releases HTTP ${response.status}`);
        const release = await response.json();
        const latest = String(release.tag_name || '').replace(/^v/i, '');
        const available = compare(latest, currentVersion) > 0;
        return { status: available ? 'available' : 'current', current: currentVersion, latest, available, url: releaseUrl(release.html_url) };
      })()]);
    } finally { root.clearTimeout(timer); }
  }

  return { RELEASE_API, check, compare, parts };
});
