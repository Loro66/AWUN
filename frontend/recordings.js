/* Recording identity is separate from the provider's playback identity. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?()=>require('./library-matcher.js'):()=>root.SongvaleLibraryMatcher);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SongvaleRecordings=api;
})(typeof globalThis==='object'?globalThis:this,function(getMatcher){
  const SOURCES=new Set(['youtube','soundcloud','audius','jamendo','internet_archive']);
  const rawKey=track=>`${track?.source||''}:${track?.id||''}`;
  const key=track=>track?.recording_key||rawKey(track);
  function fingerprint(track){
    const matcher=getMatcher(),artist=matcher.cleanArtist(track?.artist),raw=String(track?.title||'');let title=matcher.cleanTitle(raw);
    if(artist&&title.startsWith(artist+' '))title=title.slice(artist.length+1);
    const master=/\bremaster(?:ed)?(?:\s+(\d{4}))?\b/i.exec(raw);
    return {artist,title,master:master?`remaster:${master[1]||''}`:'',duration:Number(track?.recording_duration||track?.duration)||0};
  }
  function same(left,right){
    if(!left?.id||!right?.id)return false;if(rawKey(left)===rawKey(right))return true;
    if(!SOURCES.has(left.source)||!SOURCES.has(right.source)||Boolean(left.is_preview)!==Boolean(right.is_preview))return false;
    const a=fingerprint(left),b=fingerprint(right);
    if(!a.artist||!a.title||a.artist!==b.artist||a.title!==b.title||a.master!==b.master||!getMatcher().versionCompatible(left.title,right.title))return false;
    if(key(left)===key(right)&&(left.recording_key||right.recording_key)&&(!a.duration||!b.duration))return true;
    return a.duration>0&&b.duration>0&&Math.abs(a.duration-b.duration)<=Math.max(4,Math.min(8,Math.max(a.duration,b.duration)*.025));
  }
  function raw(track){const value={...track};delete value.variants;delete value.recording_key;return value}
  function variants(track){
    const result=[],seen=new Set();for(const item of [raw(track),...(Array.isArray(track?.variants)?track.variants:[])]){
      if(!item?.id||seen.has(rawKey(item))||!same(track,item))continue;
      seen.add(rawKey(item));result.push(raw(item));if(result.length>=12)break;
    }return result;
  }
  function group(items,limit=1500){
    const result=[],byRaw=new Map(),buckets=new Map();
    for(const item of Array.isArray(items)?items:[]){
      if(!item?.id)continue;
      const f=fingerprint(item),bucket=SOURCES.has(item.source)&&f.artist&&f.title&&f.duration?`${f.artist}|${f.title}|${f.master}|${Boolean(item.is_preview)}`:rawKey(item);
      let entry=byRaw.get(rawKey(item))||(buckets.get(bucket)||[]).find(g=>g.variants.every(v=>same(v,item)));
      if(!entry){if(result.length>=limit)continue;entry={...item,recording_key:key(item),variants:[]};result.push(entry);if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push(entry)}
      const known=new Set(entry.variants.map(rawKey));for(const variant of variants(item)){
        if(known.has(rawKey(variant))){const at=entry.variants.findIndex(v=>rawKey(v)===rawKey(variant));if(variant.stream_url||!entry.variants[at].stream_url){entry.variants[at]={...entry.variants[at],...variant};if(rawKey(entry)===rawKey(variant))Object.assign(entry,variant)}}
        else if(entry.variants.length<12){entry.variants.push(variant);known.add(rawKey(variant));byRaw.set(rawKey(variant),entry)}
      }
    }
    return result.map(entry=>{const preferred=rankVariants(entry)[0]||entry;return {...preferred,recording_key:key(entry),variants:entry.variants}});
  }
  function descriptor(track){
    const fields=['id','source','title','artist','duration','quality','stream_type','is_preview','recording_key','recording_duration','offline_allowed','license_url'];
    const value=Object.fromEntries(fields.filter(field=>track?.[field]!=null).map(field=>[field,track[field]]));
    value.stream_url=track?.source==='youtube'?track.stream_url||'':'';return value;
  }
  function rankVariants(track,{preferences=[],blocked=new Set(),cached=()=>false}={}){
    const options=variants(track).filter(v=>!blocked.has(rawKey(v))),remembered=preferences.find(item=>same(item.track,track));
    const weight={audius:50,jamendo:48,internet_archive:44,soundcloud:40,youtube:20};
    const score=v=>(cached(v)?1000:0)+(remembered?.source===v.source&&remembered?.id===v.id?500:0)+(v.is_preview?-500:0)+(v.stream_type==='hls'?-4:0)+(weight[v.source]||0);
    return options.sort((a,b)=>score(b)-score(a));
  }
  function choose(track,options={}){
    const picked=rankVariants(track,options)[0]||raw(track);
    return {...picked,recording_key:key(track),recording_duration:track.recording_duration||track.duration,variants:variants(track)};
  }
  function remember(preferences,track,now=Date.now()){
    return [{track:{...descriptor(track),recording_key:key(track)},source:track.source,id:track.id,at:now},...(Array.isArray(preferences)?preferences:[]).filter(item=>!same(item.track,track))].slice(0,256);
  }
  return {rawKey,key,fingerprint,same,raw,variants,group,descriptor,rankVariants,choose,remember,SOURCES};
});
