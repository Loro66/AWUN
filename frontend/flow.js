(() => {
  const app=window.awunApp;if(!app)return;
  const {state,ui,playTrack,render,toggleSave,setMessage,sourceLabels,decodeText,matchText,requestSearch,refreshStatus,replaceQueue,appendQueue}=app;
  const t=(key,values={})=>window.awunI18n.t(key,values);
  const storage=window.awunStorage,engine=window.songvalePreferences,taste=window.songvaleTaste;
  const settings=()=>taste.profile().settings;
  const MAX_QUEUE=80,MAX_RESULTS=160,LOW_WATER=8;
  const issued=engine.createWindow(1500),queried=new Set();
  const waveProfile=window.songvaleWaveProfile;
  const profileStore=waveProfile.createStore({read:storage.readJSON,write:storage.writeJSON});
  const currentOwner=()=>storage.readText('songvale-account-owner-v1','')||'guest';
  let profileOwner=currentOwner();
  const moodTerms={any:'',calm:'calm mellow',energy:'energetic',focus:'focus instrumental',happy:'happy upbeat',sad:'melancholic',night:'night'};
  const activityTerms={any:'',work:'work focus',drive:'driving',training:'workout',relax:'relax'};
  const languageTerms={any:'',ru:'русская музыка',foreign:'international music',instrumental:'instrumental'};
  const eraTerms={any:'',fresh:'new music','2010s':'2010s','2000s':'2000s',classics:'classic'};
  const ids=['flowButton','flowBadge','sidebarWaveStatus','flowPanel','flowClose','flowStart','flowSeed','flowStats','flowReset','flowMood','flowActivity','flowLanguage','flowEra','flowDiscovery','flowLike','flowDislike','flowBlockArtist','flowStatusCard','flowStatus','flowRetry'];
  const flow=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  if(ids.some(id=>!flow[id]))return;

  const freshProfile=waveProfile.fresh;
  const profile=profileStore.get(profileOwner);
  state.flow={generation:0,active:false,fetching:false,exhausted:false,queueEnded:false,statusKey:'flowReadyStatus',statusValues:{},statusTone:'idle',baseQuery:'',queryCursor:0,discoverySeeds:[],controller:null,seen:new Set(),progress:new Map(),profile};

  function setFlowStatus(key,values={},tone='notice'){
    state.flow.statusKey=key;state.flow.statusValues=values;state.flow.statusTone=tone;updateFlowUi();
  }

  let profileSaveTimer=null;
  function flushProfile(){clearTimeout(profileSaveTimer);profileSaveTimer=null;const saved=profileStore.save(profileOwner,profile);if(!saved)setMessage(t('storageSaveFailed'),'error');return saved}
  function syncProfileOwner(){
    const owner=currentOwner();if(owner===profileOwner)return;
    flushProfile();profileOwner=owner;Object.assign(profile,profileStore.get(owner));
    state.flow.seen.clear();state.flow.progress.clear();state.flow.discoverySeeds=[];issued.clear();queried.clear();stopFlow(true);
  }
  function saveProfile(defer=false){if(defer){if(!profileSaveTimer)profileSaveTimer=setTimeout(flushProfile,180)}else flushProfile();updateFlowUi()}
  window.addEventListener('pagehide',flushProfile);
  function trackSnapshot(track){return{id:String(track?.id||''),title:decodeText(track?.title||''),artist:decodeText(track?.artist||''),source:String(track?.source||''),at:Date.now()}}
  function record(type,track,extra={}){
    syncProfileOwner();if(!track?.id)return;
    const last=profile.signals.at(-1);if(last&&last.type===type&&last.id===track.id&&Date.now()-last.at<1500)return;
    profile.signals.push({...trackSnapshot(track),type,...extra});profile.signals=profile.signals.slice(-800);saveProfile(type!=='like'&&type!=='dislike');
  }
  function signalsFor(track){const key=engine.recordingKey(track);return profile.signals.filter(signal=>engine.recordingKey(signal)===key)}
  function latestReaction(track){return[...signalsFor(track)].reverse().find(signal=>signal.type==='like'||signal.type==='dislike')?.type||''}
  function knownIds(){return new Set([...profile.signals,...state.saved].map(engine.recordingKey))}
  function dislikedRecordings(){return new Set([...waveProfile.reactions(profile.signals)].filter(([,type])=>type==='dislike').map(([key])=>key))}
  function blockedArtists(){return new Set(profile.blockedArtists.map(matchText).filter(Boolean))}
  function positiveSeeds(){
    const collection=settings().libraryId,inventory=collection?taste.tracks(collection):app.libraryInventory();
    const allowed=collection?new Set(inventory.map(engine.recordingKey)):null;
    const rated=Object.values(taste.profile().ratings).filter(entry=>(engine.score(entry.values,settings().weights)||0)>=3.5).sort((a,b)=>engine.score(b.values,settings().weights)-engine.score(a.values,settings().weights)).map(entry=>entry.track);
    const rejected=dislikedRecordings(),blocked=blockedArtists();
    const liked=[...profile.signals].reverse().filter(signal=>(signal.type==='like'||signal.type==='complete')&&!rejected.has(engine.recordingKey(signal))&&!blocked.has(matchText(signal.artist)));
    const unique=new Map();
    [...rated,...liked,...inventory,state.active].filter(Boolean).forEach(item=>{const key=engine.recordingKey(item);if(item.id&&!rejected.has(key)&&!blocked.has(matchText(item.artist))&&(!allowed||allowed.has(key))&&!unique.has(key))unique.set(key,item)});
    return [...unique.values()].slice(0,16);
  }
  function artistAffinity(){
    const map=new Map();for(const signal of profile.signals){const key=matchText(signal.artist);if(!key)continue;const weight={like:18,complete:9,listen30:4,play:1,skip:-7,dislike:-28}[signal.type]||0;map.set(key,(map.get(key)||0)+weight)}
    for(const track of state.saved){const key=matchText(track.artist);if(key)map.set(key,(map.get(key)||0)+12)}
    for(const entry of Object.values(taste.profile().ratings)){const value=engine.score(entry.values,settings().weights),key=matchText(entry.track.artist);if(key&&value!==null)map.set(key,(map.get(key)||0)+(value-3)*15)}
    return map;
  }
  function sourceAffinity(){
    const map=new Map();for(const signal of profile.signals){if(!signal.source)continue;const weight={like:4,complete:3,listen30:1,skip:-2,dislike:-4}[signal.type]||0;map.set(signal.source,(map.get(signal.source)||0)+weight)}return map;
  }
  function stableNoise(track){let hash=2166136261;for(const char of `${track.id}:${profile.signals.length}`){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return((hash>>>0)%1000)/100}
  function scoringContext(){
    const reactions=waveProfile.reactions(profile.signals);
    return{known:knownIds(),saved:new Set(state.saved.map(engine.recordingKey)),reactions,artists:artistAffinity(),sources:sourceAffinity(),collectionArtists:new Set((settings().libraryId?taste.tracks(settings().libraryId):[]).map(track=>matchText(track.artist)))};
  }
  function candidateScore(track,context=scoringContext()){
    const key=engine.recordingKey(track),known=context.known.has(key),reaction=context.reactions.get(key)||'',artist=matchText(track.artist);let score=Number(track.score)||50;
    score+=Math.max(-100,Math.min(100,context.artists.get(artist)||0))+Math.max(-30,Math.min(30,context.sources.get(track.source)||0))+stableNoise(track);
    const rating=taste.score(track);if(rating!==null)score+=(rating-3)*35;if(context.collectionArtists.has(artist))score+=45;
    if(context.saved.has(key))score+=42;
    if(reaction==='like')score+=70;if(reaction==='dislike')score-=1000;
    score+=profile.discovery==='familiar'?(known?34:-4):profile.discovery==='new'?(known?-55:26):(known?8:12);
    if(state.active&&artist&&artist===matchText(state.active.artist))score+=profile.discovery==='familiar'?24:profile.discovery==='new'?-22:8;
    if(Number(track.duration)>900)score-=60;if(Number(track.duration)&&Number(track.duration)<45)score-=12;
    if(state.flow.seen.has(track.id))score-=160;return score;
  }
  function rankCandidates(candidates,{allowIssued=false}={}){
    const blocked=dislikedRecordings(),blockedArtistKeys=blockedArtists(),context=scoringContext(),unique=new Map();
    for(const track of candidates){
      if(!track?.id||!track.stream_url||blocked.has(engine.recordingKey(track))||blockedArtistKeys.has(matchText(track.artist))||track.source==='yandex_music'||taste.values(track).overall===1)continue;
      if(!allowIssued&&issued.has(track))continue;
      const key=engine.recordingKey(track);if(!unique.has(key))unique.set(key,track);
    }
    const sorted=[...unique.values()].map(track=>({track,score:candidateScore(track,context)})).sort((a,b)=>b.score-a.score).map(entry=>entry.track);
    return engine.diversify(sorted,settings().artistGap,[state.active,...state.queue].filter(Boolean).slice(-settings().artistGap));
  }
  function revealFlowResults(){
    state.collection='';state.library=false;state.hasSearched=true;ui.libraryButton.classList.remove('active');ui.libraryButton.setAttribute('aria-pressed','false');ui.searchNavButton.classList.add('active');ui.searchNavButton.setAttribute('aria-pressed','true');
  }
  function buildQueries(){
    const seeds=positiveSeeds(),base=state.flow.baseQuery||ui.searchInput.value.trim(),queries=[];
    const mood=moodTerms[profile.mood],activity=activityTerms[profile.activity],language=languageTerms[profile.language],era=eraTerms[profile.era];
    const add=(...parts)=>{const query=parts.filter(Boolean).join(' ').trim();if(query&&!queries.includes(query))queries.push(query)};
    if(profile.discovery==='new'){
      add(mood||activity,language);
      add(activity,language);
      add(language,era||'new music');
      add(language||'music');
      add(seeds[0]?.artist&&seeds[0].artist!=='Yandex Music'?seeds[0].artist:'',mood);
    }else{
      add(base,mood);
      for(const seed of seeds.slice(0,2)){
        const artist=seed.artist&&seed.artist!=='Yandex Music'?seed.artist:'';
        add(artist,mood,language);
        if(profile.discovery==='familiar')add(artist);
        else add(artist,seed.title);
      }
      add(mood||activity,language,era);
      add(language||era||'new music');
    }
    add(document.documentElement.lang==='ru'?'новая музыка':'new music');
    for(const seed of seeds)add(seed.artist,mood||activity,language,era);
    for(const artist of state.flow.discoverySeeds)add(artist,mood||activity,language);
    const styles=profile.discovery==='familiar'?['acoustic','live','popular']:['indie','electronic','alternative','acoustic','ambient','soul','instrumental','discover'];
    for(const style of styles)add(mood||activity,style,language,era);
    return queries.slice(0,64);
  }
  async function requestCandidates(query,signal){
    const sources=[...state.sources].filter(source=>!state.available.size||state.available.has(source));
    if(!sources.length)throw new Error(t('flowSearchFailed'));
    const {data}=await requestSearch({query,limit:30,sources,region:state.region,locale:navigator.language||null,fast:true},{signal,waitForFallback:true});
    if(!data.tracks?.length&&Object.keys(data.errors||{}).length)throw new Error(t('flowSearchFailed'));
    return data.tracks||[];
  }
  async function primeLocalFlow(){
    const local=settings().libraryId?taste.tracks(settings().libraryId):[state.active,...state.tracks,...app.libraryInventory()].filter(Boolean);
    const ranked=rankCandidates(local);if(!ranked.length)return false;
    state.tracks=ranked.slice(0,MAX_QUEUE);state.tracks.forEach(track=>issued.add(track));revealFlowResults();replaceQueue(state.tracks,'context');render();
    setFlowStatus('flowPlayingLocalStatus',{},'notice');setMessage(t('flowLive',{count:state.queue.length}),'notice');if(!state.active)void playTrack(state.tracks[0],{preserveQueue:true});return true;
  }
  async function fillFlow(initial=false){
    if(state.flow.fetching||state.flow.exhausted||!state.flow.active||(!initial&&state.queue.length>=MAX_QUEUE))return;
    const generation=state.flow.generation;state.flow.fetching=true;if(initial)revealFlowResults();setFlowStatus('flowConnectingStatus',{},'loading');setMessage(t('flowConnectingStatus'),'loading');render();
    let timeoutId=null,controller=null;
    try{
      if(!state.sources.size)await refreshStatus();if(!state.sources.size)throw new Error(t('flowSearchFailed'));
      if(generation!==state.flow.generation||!state.flow.active)return;
      const queries=buildQueries().filter(query=>!queried.has(matchText(query)));
      if(!queries.length){const error=new Error(t('flowNoRecommendations'));error.code='empty';throw error}
      controller=new AbortController();state.flow.controller=controller;timeoutId=setTimeout(()=>controller.abort(),12000);
      let ranked=[],failed=0;const attempts=Math.min(8,queries.length);
      for(let attempt=0;attempt<attempts;attempt++){
        const query=queries[attempt];queried.add(matchText(query));if(queried.size>256)queried.delete(queried.values().next().value);state.flow.queryCursor+=1;
        const values={attempt:attempt+1,total:attempts};setFlowStatus('flowSearchingStatus',values,'loading');setMessage(t('flowSearchingStatus',values),'loading');
        let remote=[];
        try{remote=await requestCandidates(query,controller.signal)}catch(error){if(controller.signal.aborted)throw error;failed+=1;continue}
        if(controller.signal.aborted||generation!==state.flow.generation||!state.flow.active)return;
        ranked=rankCandidates(remote).slice(0,Math.min(30,MAX_QUEUE-state.queue.length));
        if(ranked.length)break;
      }
      if(!ranked.length){const error=new Error(t('flowNoRecommendations'));error.code=failed?'network':'empty';throw error}
      ranked.forEach(track=>issued.add(track));
      const combined=initial?ranked:[...state.tracks,...ranked];state.tracks=combined.slice(-MAX_RESULTS);
      if(state.active&&!state.tracks.some(track=>track.id===state.active.id))state.tracks.unshift(state.active);
      if(state.tracks.length>MAX_RESULTS)state.tracks.splice(1,1);
      const artists=new Set([...ranked.map(track=>track.artist),...state.flow.discoverySeeds].filter(Boolean));state.flow.discoverySeeds=[...artists].slice(0,24);
      if(initial)revealFlowResults();if(initial)replaceQueue(state.tracks,'context');else appendQueue(ranked,'context');render();
      const resume=state.flow.queueEnded;state.flow.queueEnded=false;
      if(initial&&!state.active)await playTrack(state.tracks[0],{preserveQueue:true});else if(resume)await playTrack(ranked[0],{preserveQueue:true});
      if(generation!==state.flow.generation||!state.flow.active)return;
      setFlowStatus('flowFoundStatus',{count:ranked.length},'success');setMessage(t('flowLive',{count:state.queue.length}),'notice');
    }catch(error){
      if(generation!==state.flow.generation||!state.flow.active)return;
      const empty=error.code==='empty';state.flow.exhausted=true;
      const key=state.flow.queueEnded?'flowQueueEnded':state.tracks.length?(empty?'flowExhaustedStatus':'flowSourceUnavailableStatus'):(empty?'flowNoRecommendations':'flowErrorStatus');
      setFlowStatus(key,{},empty?'empty':'error');setMessage(t(key),state.tracks.length?'notice':'error');
      if(initial)stopFlow(true,true);
    }
    finally{if(timeoutId)clearTimeout(timeoutId);controller?.abort();if(generation===state.flow.generation){state.flow.controller=null;state.flow.fetching=false;updateFlowUi()}}
  }
  async function startFlow(){
    if(state.flow.active){stopFlow();return}
    app.cancelSearch();state.flow.generation+=1;
    state.flow.baseQuery=ui.searchInput.value.trim()||[state.active?.artist,state.active?.title].filter(Boolean).join(' ')||positiveSeeds()[0]?.artist||(document.documentElement.lang==='ru'?'новая музыка':'new music');
    state.flow.active=true;state.flow.exhausted=false;state.flow.queueEnded=false;state.flow.queryCursor=0;state.flow.discoverySeeds=[];queried.clear();issued.clear();state.flow.seen.clear();document.body.classList.add('flow-active');closePanel();setFlowStatus('flowConnectingStatus',{},'loading');if(await primeLocalFlow()){if(settings().continuous)void fillFlow(false);return}await fillFlow(true);
  }
  function stopFlow(silent=false,preserveStatus=false){state.flow.generation+=1;state.flow.controller?.abort();state.flow.fetching=false;state.flow.active=false;document.body.classList.remove('flow-active');if(!preserveStatus){state.flow.exhausted=false;state.flow.queueEnded=false;setFlowStatus(silent?'flowReadyStatus':'flowStoppedStatus',{},'idle')}else updateFlowUi();if(!silent)setMessage(t('flowStopped'),'notice')}
  function retryFlow(){if(!state.flow.active)return;state.flow.exhausted=false;state.flow.queryCursor=0;queried.clear();void fillFlow(!state.tracks.length)}
  function refreshFlow(){if(!state.flow.active)return;state.flow.generation+=1;state.flow.controller?.abort();state.flow.fetching=false;state.flow.exhausted=false;state.flow.queryCursor=0;queried.clear();replaceQueue(rankCandidates(state.queue,{allowIssued:true}),'context');if(settings().continuous)void fillFlow(!state.tracks.length);else updateFlowUi()}
  function openPanel(){flow.flowPanel.hidden=false;flow.flowButton.setAttribute('aria-expanded','true');document.body.classList.add('flow-screen-open');flow.flowPanel.classList.add('open');updateFlowUi()}
  function closePanel(){flow.flowPanel.classList.remove('open');flow.flowButton.setAttribute('aria-expanded','false');document.body.classList.remove('flow-screen-open');flow.flowPanel.hidden=true}
  function updateFlowUi(){
    syncProfileOwner();
    const badge=state.flow.fetching||state.flow.active&&state.flow.statusTone==='loading'?'flowBadgeSearching':state.flow.exhausted?(state.flow.statusTone==='error'?'flowBadgeError':state.flow.statusKey==='flowNoRecommendations'?'flowBadgeEmpty':'flowBadgeExhausted'):state.flow.active?'live':'ready';
    flow.flowBadge.textContent=t(badge);flow.flowButton.dataset.waveState=badge;flow.flowButton.setAttribute('aria-label',`${t('wave')} · ${t(badge)}`);flow.flowStatus.textContent=t(state.flow.statusKey,state.flow.statusValues);flow.flowStatusCard.dataset.tone=state.flow.statusTone;flow.sidebarWaveStatus.textContent=flow.flowStatus.textContent;flow.sidebarWaveStatus.hidden=state.flow.statusTone==='idle'&&!state.flow.active&&!state.flow.exhausted;flow.sidebarWaveStatus.dataset.tone=state.flow.statusTone;flow.flowRetry.hidden=!state.flow.active||!state.flow.exhausted;
    const more=document.getElementById('flowMore');if(more){more.hidden=!state.flow.active||state.library||!settings().continuous;more.disabled=state.flow.fetching||state.queue.length>=MAX_QUEUE;more.textContent=t(state.flow.exhausted?'flowRetry':'flowMore')}
    flow.flowButton.classList.toggle('active',state.flow.active);flow.flowStart.textContent=t(state.flow.active?'stopWave':'startWave');flow.flowStart.classList.toggle('stop',state.flow.active);flow.flowStats.textContent=t('flowStats',{signals:profile.signals.length,blocked:profile.blockedArtists.length});
    flow.flowMood.value=profile.mood;flow.flowActivity.value=profile.activity;flow.flowLanguage.value=profile.language;flow.flowEra.value=profile.era;flow.flowDiscovery.querySelectorAll('[data-flow-discovery]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.flowDiscovery===profile.discovery)));
    const seed=state.active?[decodeText(state.active.artist),decodeText(state.active.title)].filter(Boolean).join(' — '):ui.searchInput.value.trim()||positiveSeeds()[0]?.artist||t('currentSearchOrLibrary');flow.flowSeed.textContent=t('flowSeed',{seed});
    const reaction=state.active?latestReaction(state.active):'';flow.flowLike.classList.toggle('active',reaction==='like');flow.flowDislike.classList.toggle('active',reaction==='dislike');
    for(const id of ['flowLikeAction','flowDislikeAction','flowBlockAction'])document.getElementById(id).disabled=!state.active;document.getElementById('flowLikeAction').setAttribute('aria-pressed',String(reaction==='like'));document.getElementById('flowDislikeAction').setAttribute('aria-pressed',String(reaction==='dislike'));
  }
  function likeCurrent(){if(!state.active)return;record('like',state.active);if(!state.saved.some(track=>track.id===state.active.id))toggleSave(state.active);updateFlowUi();setMessage(t('liked'),'notice')}
  function dislikeCurrent(){
    if(!state.active)return;const rejected=state.active;record('dislike',rejected);state.tracks=state.tracks.filter(track=>engine.recordingKey(track)!==engine.recordingKey(rejected));
    replaceQueue(rankCandidates(state.queue.filter(track=>engine.recordingKey(track)!==engine.recordingKey(rejected)),{allowIssued:true}),'context');const next=state.queue[0];render();if(next)void playTrack(next,{preserveQueue:true});else{app.pausePlayback();if(state.flow.active)state.flow.queueEnded=true}if(state.flow.active&&settings().continuous){state.flow.exhausted=false;void fillFlow(false)}setMessage(t('disliked'),'notice')
  }
  function blockCurrentArtist(){
    if(!state.active?.artist)return;const artist=decodeText(state.active.artist),key=matchText(artist);if(!key||profile.blockedArtists.some(value=>matchText(value)===key))return;
    profile.blockedArtists.push(artist);saveProfile();state.tracks=state.tracks.filter(track=>matchText(track.artist)!==key);replaceQueue(rankCandidates(state.queue,{allowIssued:true}),'context');const next=state.queue[0];render();if(next)void playTrack(next,{preserveQueue:true});else{app.pausePlayback();if(state.flow.active)state.flow.queueEnded=true}if(state.flow.active&&settings().continuous){state.flow.exhausted=false;void fillFlow(false)}setMessage(t('artistBlocked',{artist}),'notice');
  }
  function trackProgress({track=state.active,current,duration}={}){
    if(!track||!duration||!Number.isFinite(current))return;
    state.flow.progress.set(track.id,Math.max(0,Math.min(1,current/duration)));
    if(state.flow.progress.size>128)state.flow.progress.delete(state.flow.progress.keys().next().value);
  }

  flow.flowButton.addEventListener('click',()=>flow.flowPanel.hidden?openPanel():closePanel());flow.flowClose.addEventListener('click',closePanel);flow.flowStart.addEventListener('click',startFlow);flow.flowRetry.addEventListener('click',retryFlow);flow.flowLike.addEventListener('click',likeCurrent);flow.flowDislike.addEventListener('click',dislikeCurrent);flow.flowBlockArtist.addEventListener('click',blockCurrentArtist);
  document.getElementById('flowLikeAction').addEventListener('click',likeCurrent);document.getElementById('flowDislikeAction').addEventListener('click',dislikeCurrent);document.getElementById('flowBlockAction').addEventListener('click',blockCurrentArtist);
  flow.flowMood.addEventListener('change',()=>{profile.mood=flow.flowMood.value;saveProfile();refreshFlow()});flow.flowActivity.addEventListener('change',()=>{profile.activity=flow.flowActivity.value;saveProfile();refreshFlow()});
  flow.flowLanguage.addEventListener('change',()=>{profile.language=flow.flowLanguage.value;saveProfile();refreshFlow()});flow.flowEra.addEventListener('change',()=>{profile.era=flow.flowEra.value;saveProfile();refreshFlow()});
  flow.flowDiscovery.addEventListener('click',event=>{const button=event.target.closest('[data-flow-discovery]');if(!button)return;profile.discovery=button.dataset.flowDiscovery;saveProfile();refreshFlow()});
  flow.flowReset.addEventListener('click',()=>{if(!confirm(t('resetConfirm')))return;Object.assign(profile,freshProfile());saveProfile();refreshFlow();setMessage(t('tasteReset'),'notice')});
  document.addEventListener('awun:play',event=>{
    const track=event.detail.track;state.flow.seen.add(track.id);if(state.flow.seen.size>1500)state.flow.seen.delete(state.flow.seen.values().next().value);
    state.flow.progress.delete(track.id);state.flow.progress.set(track.id,0);if(state.flow.progress.size>128)state.flow.progress.delete(state.flow.progress.keys().next().value);
    record('play',track);updateFlowUi();
    if(state.flow.active&&settings().continuous&&state.queue.length<=LOW_WATER)void fillFlow(false);
  });
  document.addEventListener('awun:skip',event=>{const track=event.detail.track;if(!track)return;record('skip',track,{progress:Math.round((state.flow.progress.get(track.id)||0)*100)/100})});document.addEventListener('awun:qualified-listen',event=>record('listen30',event.detail.track));document.addEventListener('awun:qualified-complete',event=>record('complete',event.detail.track,{progress:.8}));document.addEventListener('awun:library',updateFlowUi);
  document.addEventListener('awun:queue-ended',()=>{if(!state.flow.active)return;if(!settings().continuous){stopFlow(true);return}state.flow.queueEnded=true;if(!state.flow.fetching&&!state.flow.exhausted){void fillFlow(false);return}if(state.flow.exhausted){setFlowStatus('flowQueueEnded',{},'empty');setMessage(t('flowQueueEnded'),'notice')}});
  document.addEventListener('awun:language',updateFlowUi);
  document.addEventListener('songvale:preferences',()=>{if(state.flow.active)refreshFlow()});
  let scrollFrame=null;
  window.addEventListener('scroll',()=>{if(scrollFrame||!state.flow.active||!settings().continuous||state.library||!flow.flowPanel.hidden)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;const bounds=document.getElementById('flowMore').getBoundingClientRect();if(bounds.top>innerHeight+400)return;if((state.visibleTrackLimit||60)<state.tracks.length){state.visibleTrackLimit=Math.min(MAX_RESULTS,(state.visibleTrackLimit||60)+30);render()}else if(state.queue.length<40)void fillFlow(false)})},{passive:true});
  document.getElementById('flowMore')?.addEventListener('click',()=>state.flow.exhausted?retryFlow():fillFlow(false));
  document.addEventListener('awun:render',updateFlowUi);
  document.addEventListener('awun:account-owner',updateFlowUi);
  window.addEventListener('storage',event=>{if(event.key===waveProfile.KEY||event.key===null){if(event.key!==null)syncProfileOwner();clearTimeout(profileSaveTimer);profileSaveTimer=null;profileStore.reload();profileOwner=currentOwner();Object.assign(profile,profileStore.get(profileOwner));if(event.key===null)stopFlow(true);else updateFlowUi()}else if(event.key==='songvale-account-owner-v1')updateFlowUi()});
  window.addEventListener('awun:storage-restored',()=>{clearTimeout(profileSaveTimer);profileSaveTimer=null;profileStore.reload();profileOwner=currentOwner();Object.assign(profile,profileStore.get(profileOwner));stopFlow(true)});
  document.addEventListener('awun:search',()=>{if(state.flow.active)stopFlow(true)});
  document.addEventListener('awun:progress',event=>trackProgress(event.detail));updateFlowUi();
})();
