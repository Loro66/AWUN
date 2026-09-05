(function attachAwunUpdateChecker(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.awunUpdateChecker = api;
})(typeof globalThis === 'object' ? globalThis : this, function createAwunUpdateChecker(root) {
  const RELEASE_API = 'https://api.github.com/repos/Loro66/AWUN/releases/latest';

  function parts(version) {
    return String(version || '').replace(/^v/i, '').split(/[.+-]/, 3).map(value => Number.parseInt(value, 10) || 0);
  }

  function compare(left, right) {
    const first = parts(left), second = parts(right);
    for (let index = 0; index < 3; index += 1) {
      if (first[index] !== second[index]) return first[index] > second[index] ? 1 : -1;
    }
    return 0;
  }

  async function check(currentVersion, fetcher = root.fetch.bind(root)) {
    const response = await fetcher(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (response.status === 404) return { status: 'no-release', current: currentVersion, available: false };
    if (!response.ok) throw new Error(`GitHub Releases HTTP ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!latest) throw new Error('Release version missing');
    return {
      status: compare(latest, currentVersion) > 0 ? 'available' : 'current',
      current: currentVersion,
      latest,
      available: compare(latest, currentVersion) > 0,
      url: release.html_url || 'https://github.com/Loro66/AWUN/releases',
    };
  }

  return { RELEASE_API, check, compare, parts };
});
