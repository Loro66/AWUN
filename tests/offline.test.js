const test=require('node:test'),assert=require('node:assert/strict');
const {eligible,descriptor,evictionOrder}=require('../frontend/offline.js');
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
