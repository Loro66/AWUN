const { test } = require('node:test');
const assert = require('node:assert/strict');
const wave = require('../frontend/wave-profile.js');
const key = require('../frontend/preferences.js').recordingKey;
const signal = { id:'a',source:'audius',title:'Song',artist:'Artist',type:'like',at:100 };
function memory(initial = {}) {
  let data = structuredClone(initial), fail = false;
  return { read:(key,fallback)=>structuredClone(data[key]??fallback),write:(key,value)=>{if(fail)return false;data[key]=structuredClone(value);return true}, data:()=>data,fail:()=>{fail=true} };
}
test('legacy unowned Wave history migrates to guest and never to an account', () => {
  const storage=memory({'awun-wave-profile-v2':{signals:[signal],blockedArtists:['Blocked']}}),store=wave.createStore(storage);
  assert.equal(store.get('guest').signals.length,1); assert.equal(store.get('account-a').signals.length,0);
  store.save('account-a',{...wave.fresh(),mood:'calm'});
  const restored=wave.createStore(storage); assert.equal(restored.get('guest').blockedArtists[0],'Blocked'); assert.equal(restored.get('account-a').mood,'calm');
});
test('owner updates preserve other owners and merge freshly written storage', () => {
  const storage=memory(),first=wave.createStore(storage),second=wave.createStore(storage);
  first.save('account-a',{...wave.fresh(),signals:[signal]});
  second.save('account-b',{...wave.fresh(),mood:'energy'});
  first.reload(); assert.equal(first.get('account-a').signals.length,1); assert.equal(first.get('account-b').mood,'energy');
});
test('feedback follows recording identity across providers and the latest reaction wins', () => {
  const alias={...signal,source:'soundcloud',id:'different',type:'dislike'};
  assert.equal(wave.reactions([signal,alias]).get(key(signal)),'dislike');
  assert.equal(wave.reactions([alias,signal]).get(key(alias)),'like');
  assert.notEqual(key(signal),key({...signal,title:'Song (Live)'}));
});
test('invalid/corrupt Wave signals are bounded and sanitized', () => {
  const clean=wave.sanitize({signals:[null,...Array.from({length:900},()=>signal)],blockedArtists:[null,{},'Blocked','Blocked'],mood:'unknown'});
  assert.equal(clean.signals.length,800); assert.deepEqual(clean.blockedArtists,['Blocked']);assert.equal(clean.mood,'any');
});
test('failed persistence does not replace the saved owner profile', () => {
  const storage=memory(),store=wave.createStore(storage);store.save('guest',{...wave.fresh(),mood:'calm'});storage.fail();
  assert.equal(store.save('guest',{...wave.fresh(),mood:'sad'}),false); assert.equal(store.get('guest').mood,'calm');
});
