const { test } = require('node:test');
const assert = require('node:assert/strict');
const taste = require('../frontend/preferences.js');
const track = (id, artist = 'Artist', title = id, source = 'audius') => ({ id, artist, title, source });
const a = track('a'), b = track('b'), c = track('c', 'Other');
function memoryStore() {
  let data = {}, owner = 'guest', fail = false;
  const store = taste.createStore({ read: (key, fallback) => data[key] || fallback, write: (key, value) => { if (fail) return false; data[key] = structuredClone(value); return true; }, owner: () => owner });
  return { store, owner: value => { owner = value; }, fail: () => { fail = true; }, data: () => data };
}

test('weighted ratings ignore absent dimensions and disabled weights', () => {
  assert.equal(taste.score({ melody: 5 }, { melody: 3, vocals: 3 }), 5);
  assert.equal(taste.score({ melody: 5, vocals: 1 }, { melody: 3, vocals: 1 }), 4);
  assert.equal(taste.score({ melody: 5 }, { melody: 0 }), null);
  assert.equal(taste.score({}), null);
  assert.deepEqual(taste.ratings({ overall: 6, melody: 0, vocals: '5', rhythm: 3, atmosphere: NaN }), { rhythm: 3 });
});
test('all zero or corrupt weights and settings recover to usable defaults', () => {
  assert.deepEqual(taste.weights(Object.fromEntries(taste.dimensions.map(key => [key, 0]))), taste.defaults);
  const profile = taste.sanitize({ settings: { artistGap: 100, libraryId: 'missing' }, libraries: [] });
  assert.equal(profile.settings.artistGap, 6);
  assert.equal(profile.settings.libraryId, '');
});
test('ratings update across sources while live versions keep their own ratings', () => {
  const { store } = memoryStore();
  store.rate(a, { overall: 5 });
  const copy = { ...a, id: 'other-id', source: 'soundcloud', artist: ' ARTIST ', title: 'A' };
  assert.equal(store.get().ratings[taste.recordingKey(copy)].values.overall, 5);
  assert.notEqual(taste.recordingKey(a), taste.recordingKey({ ...a, title: 'a (Live)' }));
});
test('collections overlap, combine artist and source rules, and explicitly handle unrated music', () => {
  const { store } = memoryStore();
  store.rate(a, { overall: 5, rhythm: 4 }); store.rate(b, { overall: 2, rhythm: 5 });
  const profile = store.get(), rules = profile.libraries;
  assert.deepEqual(taste.select(rules[0], [a,b,c], profile), [a]);
  assert.deepEqual(taste.select(rules[1], [a,b,c], profile), [b,a]);
  assert.deepEqual(taste.select(taste.rule({ metric: 'rhythm', artists: ['artist'], sources: ['audius'], includeUnrated: true }), [a,b,c], profile), [b,a]);
  assert.deepEqual(taste.select(taste.rule({ includeUnrated: true, sources: ['soundcloud'] }), [a,b,c], profile), []);
  assert.deepEqual(taste.select(taste.rule({ includeUnrated: true }), [c], profile), [c]);
});
test('changing weights reclassifies a collection without rewriting tracks or ratings', () => {
  const { store } = memoryStore();
  store.rate(a, { melody: 5, vocals: 1 });
  store.updateSettings({ weights: { overall: 0, melody: 5, vocals: 0, rhythm: 0, atmosphere: 0 } });
  assert.deepEqual(taste.select(store.get().libraries[0], [a], store.get()), [a]);
  store.updateSettings({ weights: { overall: 0, melody: 0, vocals: 5, rhythm: 0, atmosphere: 0 } });
  assert.deepEqual(taste.select(store.get().libraries[0], [a], store.get()), []);
  assert.deepEqual(store.get().ratings[taste.recordingKey(a)].values, { melody: 5, vocals: 1 });
});
test('custom collection rules persist, edit, and delete without changing library tracks', () => {
  const { store } = memoryStore();
  assert.equal(store.saveRule({ id: 'custom', name: 'Mine', metric: 'vocals', minScore: 3.5 }), true);
  assert.equal(store.saveRule({ id: 'custom', name: 'Edited', metric: 'melody' }), true);
  assert.equal(store.get().libraries.length, 4);
  assert.equal(store.get().libraries.at(-1).name, 'Edited');
  store.updateSettings({ libraryId: 'custom' }); store.deleteRule('custom');
  assert.equal(store.get().settings.libraryId, '');
});
test('guest and account profiles are isolated and survive switching back and reload', () => {
  const memory = memoryStore(); memory.store.rate(a, { overall: 5 });
  memory.owner('account-a'); assert.deepEqual(Object.keys(memory.store.get().ratings), []);
  memory.store.rate(b, { overall: 2 }); memory.owner('guest');
  assert.equal(memory.store.get().ratings[taste.recordingKey(a)].values.overall, 5);
  memory.store.reload(); assert.equal(memory.store.get().ratings[taste.recordingKey(b)], undefined);
});
test('a storage failure leaves the previous ratings and settings intact', () => {
  const memory = memoryStore(); memory.store.rate(a, { overall: 5 }); memory.fail();
  assert.equal(memory.store.rate(a, { overall: 1 }), false);
  assert.equal(memory.store.updateSettings({ continuous: false }), false);
  assert.equal(memory.store.get().ratings[taste.recordingKey(a)].values.overall, 5);
  assert.equal(memory.store.get().settings.continuous, true);
});
test('clearing a rating removes its collection membership', () => {
  const { store } = memoryStore(); store.rate(a, { overall: 5 }); store.rate(a, {});
  assert.deepEqual(taste.select(store.get().libraries[0], [a], store.get()), []);
});
test('recent recording window deduplicates across providers and bounds its memory', () => {
  const window = taste.createWindow(2); window.add(a);
  assert.equal(window.has({ ...a, id: 'alias', source: 'soundcloud' }), true);
  window.add(b); window.add(c); assert.equal(window.size(), 2); assert.equal(window.has(a), false);
  window.clear(); assert.equal(window.has(c), false);
});
test('artist diversity spans batches, preserves all candidates, and can be disabled', () => {
  const items = [a, b, c, track('d', 'Third')];
  const ranked = taste.diversify(items, 2, [track('previous', 'Artist')]);
  assert.equal(ranked[0].artist, 'Other'); assert.equal(ranked[1].artist, 'Third');
  assert.deepEqual(new Set(ranked), new Set(items));
  assert.deepEqual(taste.diversify(items, 0), items);
});
test('sanitization bounds ratings, rules and untrusted metadata', () => {
  const input = { ratings: Object.fromEntries(Array.from({ length: 3010 }, (_, i) => [`key-${i}`, { track: track(String(i)), values: { overall: 5 } }])), libraries: Array.from({ length: 25 }, (_, i) => ({ id: `rule-${i}`, name: 'x'.repeat(100) })) };
  const profile = taste.sanitize(input);
  assert.equal(Object.keys(profile.ratings).length, 3000); assert.equal(profile.libraries.length, 20); assert.equal(profile.libraries[0].name.length, 60);
});

test('HTML-encoded catalog credits share ratings with the saved decoded recording', () => {
  const { store } = memoryStore();
  const encoded = track('encoded', 'Earth &amp; Sky', 'Day &#x26; Night');
  store.rate(encoded, { overall: 5 });
  assert.equal(store.get().ratings[taste.recordingKey({ ...encoded, artist: 'Earth & Sky', title: 'Day & Night' })].values.overall, 5);
  assert.doesNotThrow(() => taste.normalize('Bad &#999999999; entity'));
});
