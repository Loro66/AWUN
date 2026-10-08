(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SongvaleLibraryMatcher=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const PRESENTATION=/\b(?:official(?:\s+music)?\s+(?:video|audio)|clip\s+officiel|official|officiel|lyrics?|visuali[sz]er|audio|video|hd|hq|4k|remaster(?:ed)?(?:\s+\d{4})?)\b|(?:официальн(?:ый|ое)\s+(?:клип|видео|аудио)|официальный\s+клип)/giu;
  const FEATURE=/\s+(?:feat(?:uring)?\.?|ft\.?|при\s+участии)\s+.+$/iu;
  const VERSION_RULES={
    remix:/\b(?:remix|mix|edit|rework|bootleg)\b/iu,
    live:/\b(?:live|concert|session|жив(?:ьём|ьем)|концерт)\b/iu,
    acoustic:/\b(?:acoustic|unplugged|акустическ\w*)\b/iu,
    instrumental:/\b(?:instrumental|караоке|karaoke|инструментал\w*)\b/iu,
    cover:/\b(?:cover|кавер)\b/iu,
    speed:/\b(?:slowed|sped\s+up|nightcore|speed\s+up)\b/iu,
    demo:/\b(?:demo|демо)\b/iu
  };
  const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  const cleanTitle=value=>normalize(String(value||'').replace(/[[(][^\])]*[\])]/g,part=>/\b(?:official|officiel|lyrics?|audio|video|visuali[sz]er|hd|hq|4k|remaster)|официальн/iu.test(part)?' ':part).replace(PRESENTATION,' '));
  const cleanArtist=value=>normalize(String(value||'').replace(FEATURE,' ').replace(/(?:\s*[-–—]\s*Topic|\s+Official|VEVO)$/iu,' '));
  function titleWithoutArtist(value,artist){
    const title=cleanTitle(value);
    if(!artist)return{title,credited:false};
    if(title.startsWith(artist+' '))return{title:title.slice(artist.length+1),credited:true};
    if(title.endsWith(' '+artist))return{title:title.slice(0,-artist.length-1),credited:true};
    return{title,credited:false};
  }
  const tokens=value=>new Set(normalize(value).split(' ').filter(token=>token.length>1));
  const tokenF1=(left,right)=>{
    const a=tokens(left),b=tokens(right);if(!a.size||!b.size)return 0;
    let shared=0;a.forEach(token=>{if(b.has(token))shared+=1});
    return shared?2*shared/(a.size+b.size):0;
  };
  const bigramDice=(leftValue,rightValue)=>{
    const left=normalize(leftValue).replace(/\s/g,''),right=normalize(rightValue).replace(/\s/g,'');
    if(left===right)return left?1:0;if(left.length<2||right.length<2)return 0;
    const counts=new Map();for(let i=0;i<left.length-1;i+=1){const gram=left.slice(i,i+2);counts.set(gram,(counts.get(gram)||0)+1)}
    let shared=0;for(let i=0;i<right.length-1;i+=1){const gram=right.slice(i,i+2),count=counts.get(gram)||0;if(count){shared+=1;counts.set(gram,count-1)}}
    return 2*shared/(left.length+right.length-2);
  };
  const textSimilarity=(left,right)=>{
    const a=normalize(left),b=normalize(right);if(!a||!b)return 0;if(a===b)return 1;
    const containment=(a.includes(b)||b.includes(a))?Math.min(a.length,b.length)/Math.max(a.length,b.length):0;
    return Math.max(tokenF1(a,b),bigramDice(a,b),containment*.96);
  };
  const versions=value=>new Set(Object.entries(VERSION_RULES).filter(([,rule])=>rule.test(String(value||''))).map(([name])=>name));
  const versionCompatible=(expected,actual)=>{
    const wanted=versions(expected),found=versions(actual);
    if(!wanted.size&&!found.size)return true;
    if(wanted.size!==found.size)return false;
    return [...wanted].every(item=>found.has(item));
  };
  const durationSimilarity=(expected,actual)=>{
    const left=Number(expected)||0,right=Number(actual)||0;if(!left||!right)return .62;
    const difference=Math.abs(left-right);if(difference<=4)return 1;
    const tolerance=Math.max(18,Math.min(45,left*.12));return Math.max(0,1-difference/tolerance);
  };
  function score(imported,candidate){
    const wantedArtist=imported?.artist==='Yandex Music'?'':cleanArtist(imported?.artist);
    const expected=titleWithoutArtist(imported?.title,wantedArtist),actual=titleWithoutArtist(candidate?.title,wantedArtist);
    let title=textSimilarity(expected.title,actual.title);
    if(!versionCompatible(imported?.title,candidate?.title))title=Math.min(title,.58);
    const artist=wantedArtist?Math.max(textSimilarity(wantedArtist,cleanArtist(candidate?.artist)),actual.credited ? .95 : 0):.66;
    const duration=durationSimilarity(imported?.duration,candidate?.duration);
    const confidence=title*.62+artist*.28+duration*.10;
    return{candidate,confidence,title,artist,duration};
  }
  function rankMatches(candidates,imported){
    return (Array.isArray(candidates)?candidates:[]).map(candidate=>score(imported,candidate))
      .filter(result=>result.candidate?.stream_url&&!result.candidate.is_preview)
      .sort((left,right)=>right.confidence-left.confidence||Number(right.candidate.score||0)-Number(left.candidate.score||0));
  }
  function bestMatch(candidates,imported){
    const hasArtist=Boolean(imported?.artist&&imported.artist!=='Yandex Music');
    const ranked=rankMatches(candidates,imported).filter(result=>result.title>=.68&&(!hasArtist||result.artist>=.46)&&versionCompatible(imported?.title,result.candidate.title));
    if(!ranked.length)return null;
    const best=ranked[0];
    const threshold=hasArtist ? .70 : .82,margin=ranked[1]?best.confidence-ranked[1].confidence:1;
    if(best.confidence<threshold||(best.confidence<.9&&margin<.025))return null;
    return best;
  }
  function reviewCandidates(candidates,imported,limit=3){
    const hasArtist=Boolean(imported?.artist&&imported.artist!=='Yandex Music');
    return rankMatches(candidates,imported).filter(result=>result.title>=.48&&(!hasArtist||result.artist>=.3)&&versionCompatible(imported?.title,result.candidate.title)).slice(0,Math.max(1,Number(limit)||3));
  }
  const cleanedSearch=value=>String(value||'').replace(/[[(][^\])]*[\])]/g,' ').replace(PRESENTATION,' ').replace(/\s+/g,' ').trim();
  function searchQueries(imported){
    const artist=imported?.artist==='Yandex Music'?'':String(imported?.artist||'').trim(),title=String(imported?.title||'').trim(),cleaned=cleanedSearch(title);
    return [...new Set([(artist+' '+title).trim(),(artist+' '+cleaned).trim(),cleaned].filter(Boolean))];
  }
  return{normalize,cleanTitle,cleanArtist,textSimilarity,versionCompatible,durationSimilarity,score,rankMatches,bestMatch,reviewCandidates,searchQueries};
});
