/* Two media decks keep prepared direct audio separate from current playback. */
(() => {
  const app=window.awunApp,records=window.SongvaleRecordings;if(!app)return;
  const settingsKey='songvale-transitions-v1',stored=window.awunStorage.readJSON(settingsKey,{});
  const settings={preload:stored?.preload!==false,crossfade:[0,2,4,6].includes(stored?.crossfade)?stored.crossfade:0};
  const media=new Audio();media.id='audioStandby';media.crossOrigin='anonymous';media.preload='auto';document.body.append(media);app.bindAudio(media);
  const $=id=>document.getElementById(id),t=(key,values)=>window.awunI18n.t(key,values);
  let standby=media,plan=null,claimed=null,currentRelease=null,controller=null,frame=0,fading=null,cooldown=0,transitionListen=null;
  function clean(audio){audio.pause();audio.removeAttribute('src');audio.load()}
  function state(){return {status:plan?.status||'idle',track:plan?.track||plan?.requested||null,preload:settings.preload,crossfade:settings.crossfade}}
  function render(){
    if($('preloadNext'))$('preloadNext').checked=settings.preload;if($('crossfadeSeconds'))$('crossfadeSeconds').value=String(settings.crossfade);
    const label=$('sidebarPreparation');if(!label)return;
    const value=state();label.hidden=!value.track;label.textContent=value.track?t(value.status==='ready'?'nextPrepared':value.status==='error'?'nextPreparationFailed':value.status==='link'?'nextLinkPrepared':'nextPreparing',{title:value.track.title}):'';
    label.dataset.state=value.status;
  }
  function cancel(){controller?.abort();controller=null;plan?.release?.();plan=null;if(!fading&&!claimed)clean(standby);render()}
  function next(){return app.peekNextTrack()}
  function waiting(audio,signal){return new Promise((resolve,reject)=>{
    if(audio.readyState>=3){resolve();return}
    const done=error=>{clearTimeout(timer);audio.removeEventListener('canplay',ready);audio.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve()};
    const ready=()=>done(),failed=()=>done(new Error('playbackFailed')),aborted=()=>done(new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>done(new Error('requestTimedOut')),10000);audio.addEventListener('canplay',ready);audio.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
  })}
  async function schedule(){
    if(claimed||fading||performance.now()<cooldown)return;
    const requested=next();
    if(!settings.preload||!app.state.active||!requested||navigator.connection?.saveData){cancel();return}
    const stale=plan?.track&&window.awunPlayerCore.shouldRefreshStream(plan.track);
    if(plan&&records.same(plan.requested,requested)&&(!stale||app.state.active.duration-app.state.playbackPosition>45))return;
    cancel();controller=new AbortController();const signal=controller.signal,entry={requested,status:'checking',release:null,media:null};plan=entry;render();
    const deadline=setTimeout(()=>{if(plan===entry){entry.status='error';entry.release?.();entry.release=null;clean(standby);controller?.abort();render()}},15000);
    try{
      const prepared=await app.prepareTrack(requested,signal);
      if(signal.aborted||plan!==entry){prepared.release?.();return}
      Object.assign(entry,prepared,{status:'link'});render();
      if(entry.track.source==='youtube'||entry.track.stream_type==='hls'||!navigator.onLine&&!entry.track.offline_playback&&entry.track.source!=='local')return;
      standby.src=entry.track.stream_url;standby.preload='auto';standby.load();entry.media=standby;
      await waiting(standby,signal);if(signal.aborted||plan!==entry)return;
      entry.status='ready';render();startTicker();
    }catch(error){if(signal.aborted||plan!==entry)return;entry.release?.();entry.release=null;clean(standby);entry.status='error';render()}finally{clearTimeout(deadline)}
  }
  function claim(track){
    if(!plan||!['ready','link'].includes(plan.status)||records.rawKey(plan.track)!==records.rawKey(track)||window.awunPlayerCore.shouldRefreshStream(plan.track))return null;
    claimed=plan;claimed.automatic=app.state.transitionAutomatic;claimed.previousListening=transitionListen;transitionListen=null;plan=null;controller=null;render();return claimed.track;
  }
  function releaseCurrent(){currentRelease?.();currentRelease=null}
  function finishClaim(){if(claimed){releaseCurrent();currentRelease=claimed.release;claimed=null}render()}
  async function playPrepared(track){
    if(!claimed?.media||records.rawKey(claimed.track)!==records.rawKey(track))return false;
    const entry=claimed,generation=app.state.playbackGeneration;
    const previous=app.ui.audio,incoming=entry.media,engine=app.state.audioEngine;
    const oldRelease=currentRelease,oldHls=app.state.hls;
    const oldPosition=Number(previous.currentTime)||0,oldFile=entry.previousListening?.track?.local_file_id||(entry.previousListening?.track?.source==='local'?entry.previousListening.track.id:null);
    const remaining=Math.max(0,Number(previous.duration)-Number(previous.currentTime));
    const fade=entry.automatic?Math.min(settings.crossfade||.08,remaining):.08;
    previous.id='audioStandby';incoming.id='audio';app.ui.audio=incoming;standby=previous;app.state.hls=null;app.state.audioTrackId=track.id;
    incoming.volume=engine?.available?1:Number(app.ui.volume.value)/100;
    if(engine?.available)engine.activate(incoming,fade);else previous.pause();
    currentRelease=entry.release;claimed=null;cooldown=performance.now()+fade*1000;
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(fading?.timer);const advanced=Math.max(0,(Number(previous.currentTime)||0)-oldPosition);clean(previous);oldHls?.destroy();oldRelease?.();fading=null;if(app.state.fadingFileId===oldFile)app.state.fadingFileId=null;if(entry.previousListening)app.recordFadingListen(entry.previousListening,advanced);void schedule()};
    app.state.fadingFileId=oldFile;
    fading={finish,timer:setTimeout(finish,Math.max(20,fade*1000))};
    try{await incoming.play()}catch(error){
      if(generation!==app.state.playbackGeneration)return false;
      clearTimeout(fading?.timer);fading=null;app.state.fadingFileId=null;incoming.id='audioStandby';previous.id='audio';app.ui.audio=previous;standby=incoming;app.state.hls=oldHls;engine?.activate(previous,0);currentRelease=oldRelease;claimed=entry;claimed.media=null;clean(incoming);return false;
    }
    if(generation!==app.state.playbackGeneration)return false;render();return true;
  }
  function tick(){
    frame=0;
    if(!shouldTick())return;
    const active=app.state.active,audio=app.ui.audio,remaining=Number(audio.duration)-Number(audio.currentTime);
    if(plan?.track&&window.awunPlayerCore.shouldRefreshStream(plan.track)&&remaining<=45)void schedule();
    if(settings.preload&&plan?.status==='ready'&&active?.source!=='youtube'&&app.state.repeatMode!=='one'&&!audio.seeking&&!app.state.pendingTrackId&&Number.isFinite(remaining)&&remaining>0&&remaining<=Math.max(.1,settings.crossfade)&&records.same(plan.requested,next())){
      transitionListen=app.listeningSnapshot();app.state.transitionAutomatic=true;app.finishTrack(true);app.state.transitionAutomatic=false;
    }
    if(shouldTick())frame=requestAnimationFrame(tick);
  }
  function shouldTick(){return app.state.isPlaying&&plan?.status==='ready'&&app.state.active?.source!=='youtube'&&app.state.repeatMode!=='one'}
  function startTicker(){if(!frame&&shouldTick())frame=requestAnimationFrame(tick)}
  function playing(event){if(event.detail.playing){void schedule();startTicker()}else{cancelAnimationFrame(frame);frame=0;fading?.finish()}}
  document.addEventListener('awun:queue',()=>void schedule());document.addEventListener('awun:playing',playing);document.addEventListener('awun:language',render);
  document.addEventListener('awun:local-files',()=>{const target=plan?.track?.local_file_id||plan?.track?.source==='local'&&plan.track.id;if(target&&!window.SongvaleCollections.local.tracks.some(file=>file.id===target)){cancel();void schedule()}});
  window.addEventListener('offline',()=>{if(plan?.track&&!plan.track.offline_playback&&plan.track.source!=='local')cancel()});
  window.addEventListener('pagehide',()=>{cancel();fading?.finish();releaseCurrent()});
  $('preloadNext')?.addEventListener('change',event=>{settings.preload=event.target.checked;window.awunStorage.writeJSON(settingsKey,settings);void schedule()});
  $('crossfadeSeconds')?.addEventListener('change',event=>{settings.crossfade=Number(event.target.value);window.awunStorage.writeJSON(settingsKey,settings);render()});
  window.SongvaleContinuous={schedule,claim,playPrepared,finishClaim,releaseCurrent,cancel,state,settings,render};render();void schedule();
})();
