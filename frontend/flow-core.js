(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?()=>require('./recordings.js'):()=>root.SongvaleRecordings);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SongvaleFlowCore=api;
})(typeof globalThis==='object'?globalThis:this,function(getRecordings){
  const same=(signal,track)=>getRecordings().same(signal,track);
  function reaction(signals,track){return [...signals].reverse().find(signal=>['like','dislike'].includes(signal.type)&&same(signal,track))?.type||''}
  function weight(signal){
    if(signal.type==='skip'){
      const seconds=Number(signal.listened_seconds),progress=Number(signal.progress)||0;
      if(progress>=.8||seconds>=90)return 0;
      if(seconds>0&&seconds<8||progress<.08)return -12;
      return progress>=.5?-2:-6;
    }
    return {like:18,dislike:-28,complete:9,listen30:4,play:1}[signal.type]||0;
  }
  function effective(signals){
    const reactions=[];for(const signal of [...signals].reverse())if(['like','dislike'].includes(signal.type)&&!reactions.some(item=>same(item,signal)))reactions.push(signal);
    return signals.filter(signal=>!['like','dislike'].includes(signal.type)).concat(reactions);
  }
  function repeated(track,recent){return recent.some(item=>same(item,track))}
  return {reaction,weight,effective,repeated};
});
