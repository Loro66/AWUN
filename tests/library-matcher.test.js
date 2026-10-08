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

test('matches the real Indila video returned during the Yandex import failure',()=>{
  const result=matcher.bestMatch([
    track('Dernière danse','Internet Archive',215,'uncredited'),
    track('Indila - Dernière Danse (Clip Officiel)','Indila',215,'official'),
    track('Indila - Dernière Danse (Version Réorchestrée) [Audio HQ]','GoldenMusic',218,'other'),
  ],{title:'Dernière danse',artist:'Indila'});
  assert.equal(result?.candidate.id,'official');
  assert.ok(result.confidence>.95);
});

test('recognizes artist credits in video titles and Topic channel names',()=>{
  assert.equal(matcher.bestMatch([
    track("Die Antwoord - Baby’s On Fire (Official Video)",'Music channel',273,'video'),
  ],{title:"Baby's On Fire",artist:'Die Antwoord',duration:273})?.candidate.id,'video');
  assert.equal(matcher.bestMatch([
    track('Я что-то посмотрел','Locked23 - Topic',111,'topic'),
  ],{title:'Я что-то посмотрел',artist:'Locked23',duration:111})?.candidate.id,'topic');
});

test('artist-prefixed decorations still reject alternate versions and unrelated artists',()=>{
  const imported={title:'Dernière danse',artist:'Indila',duration:215};
  for(const version of ['Remix','Live','Cover','Slowed']){
    assert.equal(matcher.bestMatch([track(`Indila - Dernière danse (${version}) [Official Video]`,'Uploader',215,version)],imported),null);
  }
  assert.equal(matcher.bestMatch([track('Dernière danse','Other Artist',215,'other')],imported),null);
});

test('an ineligible top score does not hide a valid lower ranked artist match',()=>{
  const result=matcher.bestMatch([
    track('Some Very Long Original Song','Unrelated Uploader',214,'uncredited'),
    track('Some Very Long Original Songs','AWUN Artist',214,'correct'),
  ],{title:'Some Very Long Original Song',artist:'AWUN Artist'});
  assert.equal(result?.candidate.id,'correct');
});

test('library transfer keeps excerpts out of automatic matches and manual review',()=>{
  const imported={title:'Ceux qui rêvent',artist:'Pomme'};
  const preview={...track(imported.title,imported.artist,30,'preview'),is_preview:true};
  const full=track(imported.title,imported.artist,170,'full');
  assert.equal(matcher.bestMatch([preview],imported),null);
  assert.deepEqual(matcher.reviewCandidates([preview],imported),[]);
  assert.equal(matcher.bestMatch([preview,full],imported)?.candidate.id,'full');
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
