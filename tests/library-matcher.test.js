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

test('200-record anonymized benchmark reports no false matches', t=>{
  const benchmark=[];
  for(let index=0;index<100;index+=1){
    const duration=170+(index%55),title=`Signal ${index}`,artist=`Artist ${index}`;
    benchmark.push({
      imported:{title,artist,duration},
      candidates:[
        track(`${title} (Official Audio)`,artist,duration+(index%3)-1,`correct-${index}`),
        track(`${title} Remix`,artist,duration,`remix-${index}`),
        track(`Unrelated ${index}`,`Other ${index}`,duration,`wrong-${index}`),
      ],
      expected:`correct-${index}`,
    });
  }
  for(let index=100;index<150;index+=1){
    benchmark.push({
      imported:{title:`Forest ${index}`,artist:`Artist ${index}`,duration:200},
      candidates:[track(`Forest ${index} Live`,`Artist ${index}`,200,`live-${index}`)],
      expected:null,
    });
  }
  for(let index=150;index<200;index+=1){
    benchmark.push({
      imported:{title:`Quiet Path ${index}`,artist:`Artist ${index}`,duration:240},
      candidates:[track(`Different Road ${index}`,`Other ${index}`,240,`unrelated-${index}`)],
      expected:null,
    });
  }

  const metrics={correct_match:0,correct_rejection:0,false_match:0,not_found:0};
  benchmark.forEach(record=>{
    const actual=matcher.bestMatch(record.candidates,record.imported)?.candidate.id||null;
    if(record.expected&&actual===record.expected)metrics.correct_match+=1;
    else if(record.expected&&!actual)metrics.not_found+=1;
    else if(!record.expected&&!actual)metrics.correct_rejection+=1;
    else metrics.false_match+=1;
  });
  t.diagnostic(`benchmark metrics: ${JSON.stringify(metrics)}`);
  assert.equal(benchmark.length,200);
  assert.deepEqual(metrics,{correct_match:100,correct_rejection:100,false_match:0,not_found:0});
});
