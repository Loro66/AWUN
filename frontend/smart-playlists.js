(function attachSmartPlaylists(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.songvaleSmartPlaylists = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSmartPlaylists() {
  const DAY = 86400000;
  const presets = ['recent', 'frequent', 'forgotten'];
  const key = track => `${track?.source || ''}:${track?.id || ''}`;
  function inventory(saved = [], playlists = []) {
    const tracks = new Map();
    [...saved, ...playlists.flatMap(list => (list.items || []).map(item => item.track))].forEach(track => {
      if (track?.id && track?.source && !tracks.has(key(track))) tracks.set(key(track), track);
    });
    return [...tracks.values()];
  }
  function sanitize(value) {
    const result = Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    Object.entries(value).slice(0, 30000).forEach(([id, entry]) => {
      if (!entry || typeof entry !== 'object' || id.length > 250) return;
      result[id] = {
        added_at: Math.max(0, Number(entry.added_at) || 0),
        last_played: Math.max(0, Number(entry.last_played) || 0),
        plays: Math.min(1000000, Math.max(0, Math.floor(Number(entry.plays) || 0))),
      };
    });
    return result;
  }
  function noteAdditions(before, after, metadata, now = Date.now()) {
    const known = new Set(before.map(key));
    const result = sanitize(metadata);
    after.forEach(track => {
      if (!known.has(key(track))) result[key(track)] = { ...(result[key(track)] || { plays: 0, last_played: 0 }), added_at: now };
    });
    return result;
  }
  function record(metadata, track, now = Date.now()) {
    const result = sanitize(metadata);
    const previous = result[key(track)] || { added_at: 0, plays: 0 };
    result[key(track)] = { ...previous, last_played: now, plays: Math.min(1000000, previous.plays + 1) };
    return result;
  }
  function select(preset, tracks, metadata, now = Date.now()) {
    const data = sanitize(metadata);
    const entry = track => data[key(track)] || { added_at: 0, last_played: 0, plays: 0 };
    const tie = (a, b) => key(a).localeCompare(key(b));
    if (preset === 'recent') return tracks.filter(track => entry(track).added_at > 0 && entry(track).added_at >= now - 30 * DAY && entry(track).added_at <= now)
      .sort((a, b) => entry(b).added_at - entry(a).added_at || tie(a, b));
    if (preset === 'frequent') return tracks.filter(track => entry(track).plays > 0)
      .sort((a, b) => entry(b).plays - entry(a).plays || entry(b).last_played - entry(a).last_played || tie(a, b)).slice(0, 50);
    if (preset === 'forgotten') return tracks.filter(track => entry(track).last_played > 0 && entry(track).last_played < now - 30 * DAY)
      .sort((a, b) => entry(a).last_played - entry(b).last_played || tie(a, b));
    return [];
  }
  return { presets, inventory, sanitize, noteAdditions, record, select };
});
