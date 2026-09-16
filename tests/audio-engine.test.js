const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../frontend/audio-engine.js');

test('sound profiles stay conservative and distinct',()=>{
  assert.deepEqual(Object.keys(engine.PROFILES),['neutral','warm','clarity']);
  assert.equal(engine.PROFILES.neutral.low.gain,0);
  assert.ok(engine.PROFILES.warm.low.gain>engine.PROFILES.neutral.low.gain);
  assert.ok(engine.PROFILES.clarity.high.gain>engine.PROFILES.neutral.high.gain);
  for(const profile of Object.values(engine.PROFILES)){
    assert.ok(Math.abs(profile.low.gain)<=2);
    assert.ok(Math.abs(profile.high.gain)<=2);
  }
});

test('loudness correction is gated, slow and limited to three decibels',()=>{
  assert.equal(engine.loudnessCorrection(0,2),2);
  assert.ok(engine.loudnessCorrection(.03,0)>0);
  assert.ok(engine.loudnessCorrection(.5,0)<0);
  let correction=0;for(let index=0;index<200;index++)correction=engine.loudnessCorrection(.001,correction);
  assert.equal(correction,0);
  correction=0;for(let index=0;index<200;index++)correction=engine.loudnessCorrection(1,correction);
  assert.ok(correction>=-3&&correction<0);
});

test('RMS analysis measures silence and a full-scale waveform',()=>{
  assert.equal(engine.rmsFromTimeDomain(new Uint8Array([128,128,128])),0);
  assert.ok(engine.rmsFromTimeDomain(new Uint8Array([0,255,0,255]))>.98);
});
