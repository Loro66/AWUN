/* Owner-scoped Wave state and recording-level feedback. No catalog requests. */
(function attach(root, factory) {
  const engine = typeof module === 'object' && module.exports ? require('./preferences.js') : root.songvalePreferences;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.songvaleWaveProfile = api;
})(typeof globalThis === 'object' ? globalThis : this, function createWaveProfile(engine) {
  const KEY = 'awun-wave-profile-v3';
  const choices = { discovery: ['familiar','balanced','new'], mood: ['any','calm','energy','focus','happy','sad','night'], activity: ['any','work','drive','training','relax'], language: ['any','ru','foreign','instrumental'], era: ['any','fresh','2010s','2000s','classics'] };
  const signalTypes = ['play','skip','listen30','complete','like','dislike'];
  const ownerKey = owner => `owner:${owner || 'guest'}`;
  function fresh() { return { version: 3, discovery: 'balanced', mood: 'any', activity: 'any', language: 'any', era: 'any', blockedArtists: [], signals: [] }; }
  function sanitize(value) {
    const clean = fresh();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
    for (const [key, allowed] of Object.entries(choices)) if (allowed.includes(value[key])) clean[key] = value[key];
    clean.blockedArtists = [...new Set((Array.isArray(value.blockedArtists) ? value.blockedArtists : []).filter(item => typeof item === 'string').map(item => item.trim().slice(0, 300)).filter(Boolean))].slice(-200);
    clean.signals = (Array.isArray(value.signals) ? value.signals : []).slice(-800).filter(item => item && typeof item.id === 'string' && item.id && signalTypes.includes(item.type)).map(item => ({
      id: item.id.slice(0, 250), source: String(item.source || '').slice(0, 40), title: String(item.title || '').slice(0, 300), artist: String(item.artist || '').slice(0, 300), type: item.type,
      at: Math.max(0, Number(item.at) || 0), ...(Number.isFinite(item.progress) ? { progress: Math.min(1, Math.max(0, item.progress)) } : {}),
    }));
    return clean;
  }
  function createStore({ read, write }) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    let profiles;
    function reload() {
      const saved = read(KEY, null);
      profiles = { ...object(saved?.profiles) };
      if (!saved) {
        const legacy = read('awun-wave-profile-v2', null) || read('awun-flow-profile-v1', null);
        // Legacy signals had no owner. Preserve them as local guest history;
        // never attribute another person's listening to a signed-in account.
        if (legacy) profiles[ownerKey('guest')] = sanitize(legacy);
      }
    }
    reload();
    return {
      get: owner => sanitize(profiles[ownerKey(owner)]),
      save(owner, value) {
        const stored = object(read(KEY, null)?.profiles);
        const next = { ...profiles, ...stored, [ownerKey(owner)]: sanitize(value) };
        if (!write(KEY, { version: 3, profiles: next })) return false;
        profiles = next; return true;
      },
      reload,
    };
  }
  function reactions(signals) {
    const result = new Map();
    for (const signal of signals) if (signal.type === 'like' || signal.type === 'dislike') result.set(engine.recordingKey(signal), signal.type);
    return result;
  }
  return { KEY, fresh, sanitize, createStore, reactions };
});
