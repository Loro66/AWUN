/* Shared, deterministic rules for local ratings, collections and Wave discovery. */
(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.songvalePreferences = api;
})(typeof globalThis === 'object' ? globalThis : this, function createPreferences() {
  const KEY = 'awun-preferences-v1';
  const dimensions = ['overall', 'melody', 'vocals', 'rhythm', 'atmosphere'];
  const sources = ['youtube', 'soundcloud', 'audius', 'jamendo', 'internet_archive'];
  const defaults = { overall: 3, melody: 2, vocals: 1, rhythm: 2, atmosphere: 2 };
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  function normalize(value) {
    const text = String(value || '').replace(/&(amp|quot|apos|lt|gt|#(?:x[0-9a-f]+|[0-9]+));/gi, (raw, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] || raw;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : raw;
    });
    return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const trackKey = track => `${track?.source || ''}:${track?.id || ''}`;
  // Keep version words such as live/remix/instrumental in the identity.
  const recordingKey = track => track?.artist && track?.title
    ? JSON.stringify([normalize(track.artist), normalize(track.title)]) : trackKey(track);
  function ratings(value) {
    return Object.fromEntries(dimensions.filter(key => Number.isInteger(value?.[key]) && value[key] >= 1 && value[key] <= 5).map(key => [key, value[key]]));
  }
  function weights(value) {
    const result = Object.fromEntries(dimensions.map(key => [key, clamp(value?.[key] ?? defaults[key], 0, 5, defaults[key])]));
    return Object.values(result).some(Boolean) ? result : { ...defaults };
  }
  function score(values, importance = defaults) {
    let sum = 0, total = 0;
    for (const key of dimensions) {
      const value = values?.[key], weight = importance[key];
      if (Number.isInteger(value) && value >= 1 && value <= 5 && weight > 0) { sum += value * weight; total += weight; }
    }
    return total ? sum / total : null;
  }
  function rule(value, index = 0) {
    const list = items => [...new Set((Array.isArray(items) ? items : []).filter(item => typeof item === 'string').map(item => item.trim().slice(0, 120)).filter(Boolean))].slice(0, 30);
    return {
      id: String(value?.id || `collection-${index}`).slice(0, 100),
      name: String(value?.name || '').trim().slice(0, 60),
      titleKey: ['preferenceBest', 'preferenceRhythm', 'preferenceAtmosphere'].includes(value?.titleKey) ? value.titleKey : '',
      metric: dimensions.includes(value?.metric) ? value.metric : 'weighted',
      minScore: clamp(value?.minScore ?? 4, 0, 5, 4),
      artists: list(value?.artists), sources: list(value?.sources).filter(item => sources.includes(item)),
      includeUnrated: value?.includeUnrated === true,
    };
  }
  function fresh() {
    return { ratings: Object.create(null), settings: { weights: { ...defaults }, continuous: true, artistGap: 2, libraryId: '' }, libraries: [
      rule({ id: 'taste-best', titleKey: 'preferenceBest' }),
      rule({ id: 'taste-rhythm', titleKey: 'preferenceRhythm', metric: 'rhythm' }),
      rule({ id: 'taste-atmosphere', titleKey: 'preferenceAtmosphere', metric: 'atmosphere' }),
    ] };
  }
  function sanitize(value) {
    const result = fresh();
    if (!value || typeof value !== 'object') return result;
    if (value.ratings && typeof value.ratings === 'object') {
      for (const [key, entry] of Object.entries(value.ratings).slice(-3000)) {
        if (key.length > 1000 || !entry?.track?.id || !entry.track.source) continue;
        const values = ratings(entry.values);
        if (Object.keys(values).length) result.ratings[key] = { values, track: snapshot(entry.track), updatedAt: clamp(entry.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0) };
      }
    }
    const settings = value.settings || {};
    result.settings = { weights: weights(settings.weights), continuous: settings.continuous !== false, artistGap: Math.round(clamp(settings.artistGap ?? 2, 0, 6, 2)), libraryId: String(settings.libraryId || '').slice(0, 100) };
    if (Array.isArray(value.libraries)) result.libraries = [...new Map(value.libraries.slice(0, 20).map((entry, index) => { const item = rule(entry, index); return [item.id, item]; })).values()];
    if (!result.libraries.some(item => item.id === result.settings.libraryId)) result.settings.libraryId = '';
    return result;
  }
  function snapshot(track) {
    return Object.fromEntries(['source', 'id', 'title', 'artist'].map(key => [key, String(track?.[key] || '').slice(0, key === 'id' ? 250 : 300)]));
  }
  function select(collection, tracks, profile) {
    const artists = new Set(collection.artists.map(normalize)), eligible = [];
    for (const track of tracks) {
      if (artists.size && !artists.has(normalize(track.artist))) continue;
      if (collection.sources.length && !collection.sources.includes(track.source)) continue;
      const values = profile.ratings[recordingKey(track)]?.values;
      const value = collection.metric === 'weighted' ? score(values, profile.settings.weights) : values?.[collection.metric] ?? null;
      if (value === null ? !collection.includeUnrated : value < collection.minScore) continue;
      eligible.push({ track, value: value ?? -1 });
    }
    return eligible.sort((a, b) => b.value - a.value || trackKey(a.track).localeCompare(trackKey(b.track))).map(entry => entry.track);
  }
  function createStore({ read, write, owner = () => 'guest', changed = () => {} }) {
    let envelope = read(KEY, {}), currentOwner, profile, revision = 0;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) envelope = {};
    let profiles = envelope.profiles && typeof envelope.profiles === 'object' && !Array.isArray(envelope.profiles) ? envelope.profiles : {};
    function get() {
      const nextOwner = `owner:${owner() || 'guest'}`;
      if (nextOwner !== currentOwner) { currentOwner = nextOwner; profile = sanitize(profiles[currentOwner]); revision += 1; }
      return profile;
    }
    function commit(next) {
      get();
      const clean = sanitize(next), nextProfiles = { ...profiles, [currentOwner]: clean };
      if (!write(KEY, { version: 1, profiles: nextProfiles })) return false;
      profiles = nextProfiles; profile = clean; revision += 1; changed(); return true;
    }
    function rate(track, values) {
      const current = get(), next = { ...current, ratings: { ...current.ratings } }, key = recordingKey(track), clean = ratings(values);
      if (Object.keys(clean).length) {
        delete next.ratings[key];
        next.ratings[key] = { values: clean, track: snapshot(track), updatedAt: Date.now() };
      } else delete next.ratings[key];
      return commit(next);
    }
    function updateSettings(value) { const current = get(); return commit({ ...current, settings: { ...current.settings, ...value } }); }
    function saveRule(value) {
      const current = get(), item = rule(value), exists = current.libraries.some(entry => entry.id === item.id);
      if ((!item.name && !item.titleKey) || (!exists && current.libraries.length >= 20)) return false;
      return commit({ ...current, libraries: exists ? current.libraries.map(entry => entry.id === item.id ? item : entry) : [...current.libraries, item] });
    }
    function deleteRule(id) { const current = get(); return commit({ ...current, libraries: current.libraries.filter(item => item.id !== id) }); }
    function reload() { const value = read(KEY, {}); profiles = value?.profiles || {}; currentOwner = null; get(); changed(); }
    return { get, rate, updateSettings, saveRule, deleteRule, reload, revision: () => { get(); return revision; } };
  }
  // Bounded session identity set: evicted entries can reappear only after a long session.
  function createWindow(limit = 1500) {
    const keys = new Set();
    return {
      has: track => keys.has(recordingKey(track)),
      add(track) { const key = recordingKey(track); keys.delete(key); keys.add(key); while (keys.size > limit) keys.delete(keys.values().next().value); },
      clear: () => keys.clear(), size: () => keys.size,
    };
  }
  function diversify(tracks, gap = 2, previous = []) {
    const remaining = [...tracks], result = [], recent = previous.map(track => normalize(track.artist));
    while (remaining.length) {
      const excluded = recent.slice(-gap), index = gap ? remaining.findIndex(track => !excluded.includes(normalize(track.artist))) : 0;
      const track = remaining.splice(index < 0 ? 0 : index, 1)[0]; result.push(track); recent.push(normalize(track.artist));
    }
    return result;
  }
  return { KEY, dimensions, defaults, normalize, trackKey, recordingKey, ratings, weights, score, rule, fresh, sanitize, select, createStore, createWindow, diversify };
});
