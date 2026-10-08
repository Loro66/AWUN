const { test } = require('node:test');
const assert = require('node:assert/strict');
const smart = require('../frontend/smart-playlists.js');
const day = 86400000, now = Date.parse('2026-10-08T12:00:00Z');
const a = { source: 'soundcloud', id: 'a', title: 'Song' }, b = { source: 'audius', id: 'b', title: 'Song' }, c = { source: 'soundcloud', id: 'c', title: 'Song (Live)' };

test('smart inventory includes playlist-only tracks and preserves other versions', () => {
  assert.deepEqual(smart.inventory([a], [{items:[{track:a},{track:b},{track:c}]}]), [a,b,c]);
});
test('recent rule uses real additions, applies the 30-day boundary and excludes unknown dates', () => {
  const data = smart.noteAdditions([a], [a,b,c], {}, now);
  assert.equal(data['soundcloud:a'], undefined);
  data['soundcloud:c'].added_at = now - 31 * day;
  assert.deepEqual(smart.select('recent',[a,b,c],data,now),[b]);
  assert.deepEqual(smart.select('recent',[b],data,now+31*day),[]);
});
test('frequent rule counts qualified plays and sorts by count, then last play', () => {
  let data = smart.record({}, a, now - day);
  data = smart.record(data,b,now);
  data = smart.record(data,a,now);
  assert.deepEqual(smart.select('frequent',[b,a,c],data,now),[a,b]);
});
test('forgotten excludes unplayed tracks and a new play removes an old track', () => {
  let data = smart.record({},a,now-40*day);
  data = smart.record(data,b,now-day);
  assert.deepEqual(smart.select('forgotten',[a,b,c],data,now),[a]);
  data = smart.record(data,a,now);
  assert.deepEqual(smart.select('forgotten',[a,b,c],data,now),[]);
});
test('re-adding a removed track updates its addition date without losing play count', () => {
  let data = smart.record({},a,now-day);
  data = smart.noteAdditions([], [a], data, now);
  assert.equal(data['soundcloud:a'].plays,1);
  assert.deepEqual(smart.select('recent',[a],data,now),[a]);
});
