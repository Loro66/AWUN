const test=require('node:test'),assert=require('node:assert/strict');
const {eligible,descriptor,evictionOrder}=require('../frontend/offline.js');
const {Profiles,PROFILE_KEY,Manager}=require('../frontend/offline.js');
const recordings=require('../frontend/recordings.js');
function storage(initial={}){const entries=new Map(Object.entries(initial));return {readJSON:(key,fallback)=>entries.has(key)?structuredClone(entries.get(key)):fallback,writeJSON:(key,value)=>{entries.set(key,structuredClone(value));return true}}}
const job=(id,owner)=>({owner,track:{source:'audius',id,title:id,artist:'Artist',duration:200},state:'ready',file_id:`local_${id}`});
test('legacy copies migrate to their named owner and unowned history stays guest',()=>{
 const saved=storage({'awun-offline-jobs-v1':[job('a','owner-a'),job('g',undefined)]}),profiles=new Profiles(saved);
 assert.deepEqual(profiles.load('owner-a').jobs.map(j=>j.track.id),['a']);
 assert.deepEqual(profiles.load('guest').jobs.map(j=>j.track.id),['g']);assert.deepEqual(profiles.load('owner-b').jobs,[]);
 assert.ok(saved.readJSON(PROFILE_KEY,null));
});
test('fresh profile writes retain other owners and concurrently queued jobs',()=>{
 const saved=storage(),left=new Profiles(saved),right=new Profiles(saved);
 assert.ok(left.save('owner-a',[job('a','owner-a')],'0'));assert.ok(right.save('owner-b',[job('b','owner-b')],'0'));
 assert.ok(right.save('owner-a',[job('new','owner-a')],'0'));assert.ok(left.save('owner-a',[job('a','owner-a')],'0'));
 assert.deepEqual(left.load('owner-a').jobs.map(j=>j.track.id),['a','new']);assert.equal(left.load('owner-b').jobs[0].track.id,'b');
});
test('clear invalidates an in-flight snapshot and leaves another profile intact',()=>{
 const saved=storage(),profiles=new Profiles(saved);profiles.save('owner-a',[job('a','owner-a')],'0');profiles.save('owner-b',[job('b','owner-b')],'0');
 const snapshot=profiles.load('owner-a');assert.ok(profiles.clear('owner-a',[]));assert.equal(profiles.save('owner-a',snapshot.jobs,snapshot.epoch),null);
 assert.deepEqual(profiles.load('owner-a').jobs,[]);assert.equal(profiles.load('owner-b').jobs[0].track.id,'b');
});
test('ready lookup cannot select the previous profile while owner change is pending',()=>{
 global.SongvaleRecordings=recordings;
 const manager=Object.assign(Object.create(Manager.prototype),{profileOwner:'owner-a',owner:()=> 'owner-b',jobs:[job('same','owner-a')],store:{tracks:[{id:'local_same',managed_download:true}]}});
 assert.equal(manager.jobFor(job('same','owner-b').track,true),undefined);assert.deepEqual(manager.visibleFiles(),[]);
 delete global.SongvaleRecordings;
});
test('a queue persistence failure reports a retryable storage error and never stays downloading',async()=>{
 const queued={...job('queued','guest'),state:'queued'};
 const manager=Object.assign(Object.create(Manager.prototype),{profileOwner:'guest',owner:()=> 'guest',epoch:'0',generation:0,jobs:[queued],settings:{enabled:true},networkPause:()=>'',persist:()=>false,render:()=>{},running:false});
 await manager.runQueue();assert.equal(manager.running,false);assert.equal(queued.state,'error');assert.equal(queued.error,'localStorageUnavailable');
});
test('a like or three plays qualifies only an eligible full recording',()=>{
 const track={source:'audius',id:'a',offline_allowed:true};
 assert.equal(eligible(track,{plays:2}),false);assert.equal(eligible(track,{plays:3}),true);assert.equal(eligible(track,{liked:true}),true);
 for(const variant of [{...track,source:'youtube'},{...track,source:'soundcloud'},{...track,is_preview:true},{...track,offline_allowed:false}])assert.equal(eligible(variant,{liked:true,plays:100}),false);
});
test('persisted download descriptors contain no stream links or native tokens',()=>{
 const value=descriptor({id:'a',source:'audius',title:'Song',stream_url:'blob:private',offline_url:'https://api/media/token?offline=1',online_stream_url:'https://old-port/private',local_file_id:'local_secret',offline_playback:true});
 assert.deepEqual(value,{id:'a',source:'audius',title:'Song'});
});
test('automatic eviction protects imported, active and any liked aliases of a shared file',()=>{
 const files=[{id:'own',size:100},{id:'active',managed_download:true},{id:'liked',managed_download:true},{id:'old',managed_download:true},{id:'new',managed_download:true}];
 const jobs=[{track:{source:'audius',id:'a'},file_id:'liked',used_at:1},{track:{source:'jamendo',id:'b'},file_id:'liked',used_at:2},{track:{source:'audius',id:'o'},file_id:'old',used_at:3},{track:{source:'audius',id:'n'},file_id:'new',used_at:4}];
 assert.deepEqual(evictionOrder(files,jobs,{active:'active',liked:new Set(['jamendo:b'])}).map(f=>f.id),['old','new']);
});
