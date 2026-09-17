const test=require('node:test');
const assert=require('node:assert/strict');
const matcher=require('../frontend/library-matcher.js');

const track=(title,artist,duration=210,id=title)=>({id,title,artist,duration,stream_url:'https://example.com/'+id,score:80});

test('matches harmless catalog decorations and small spelling differences',()=>{
  const imported={title:'Midnight Signal',artist:'AWUN Artist',duration:214};
  const result=matcher.bestMatch([
    track('Midnight Signals (Official Audio)','AWUN Artist',213,'close'),
    track('Completely Different','Other Artist',214,'wrong')
  ],imported);
  assert.equal(result?.candidate.id,'close');
  assert.ok(result.confidence>=.8);
});

test('normalizes featured artists and punctuation',()=>{
  const result=matcher.bestMatch(
    [track('Don’t Start Now [Official Video]','Dua Lipa',183,'dua')],
    {title:"Don't Start Now",artist:'Dua Lipa feat. Guest',duration:183}
  );
  assert.equal(result?.candidate.id,'dua');
});

test('rejects a remix, cover or live version when the import requests the original',()=>{
  const imported={title:'Teardrop',artist:'Massive Attack',duration:330};
  assert.equal(matcher.bestMatch([track('Teardrop Remix','Massive Attack',330,'remix')],imported),null);
  assert.equal(matcher.bestMatch([track('Teardrop Live','Massive Attack',330,'live')],imported),null);
  assert.equal(matcher.bestMatch([track('Teardrop Cover','Massive Attack',330,'cover')],imported),null);
});

test('duration separates otherwise identical recordings',()=>{
  const result=matcher.bestMatch([
    track('Intro','The xx',410,'extended'),
    track('Intro','The xx',127,'album')
  ],{title:'Intro',artist:'The xx',duration:129});
  assert.equal(result?.candidate.id,'album');
});

test('retry queries remove presentation labels without losing the raw query',()=>{
  assert.deepEqual(
    matcher.searchQueries({title:'Roads (Official Video)',artist:'Portishead'}),
    ['Portishead Roads (Official Video)','Portishead Roads','Roads']
  );
});
