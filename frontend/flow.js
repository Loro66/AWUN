(() => {
  const app=window.awunApp;if(!app)return;
  const {state,ui,playTrack,render,toggleSave,setMessage,sourceLabels,decodeText,matchText,requestSearch,refreshStatus,replaceQueue,appendQueue}=app;
  const t=(key,values={})=>window.awunI18n.t(key,values);
  const storage=window.awunStorage;
  const PROFILE_KEY='awun-wave-profile-v2';
  const moodTerms={any:'',calm:'calm mellow',energy:'energetic',focus:'focus instrumental',happy:'happy upbeat',sad:'melancholic',night:'night'};
  const activityTerms={any:'',work:'work focus',drive:'driving',training:'workout',relax:'relax'};
  const languageTerms={any:'',ru:'русская музыка',foreign:'international music',instrumental:'instrumental'};
  const eraTerms={any:'',fresh:'new release 2026','2010s':'2010s','2000s':'2000s',classics:'classic'};
  const ids=['flowButton','flowBadge','flowPanel','flowClose','flowStart','flowSeed','flowStats','flowReset','flowMood','flowActivity','flowLanguage','flowEra','flowDiscovery','flowLike','flowDislike','flowBlockArtist'];
  const flow=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
  if(ids.some(id=>!flow[id]))return;

  function freshProfile(){return{version:2,discovery:'balanced',mood:'any',activity:'any',language:'any',era:'any',blockedArtists:[],signals:[]}}
  function loadProfile(){
    const value=storage?.readJSON?.(PROFILE_KEY,null)||storage?.readJSON?.('awun-flow-profile-v1',null);if(!value||!Array.isArray(value.signals))return freshProfile();
    return{version:2,discovery:['familiar','balanced','new'].includes(value.discovery)?value.discovery:'balanced',mood:moodTerms[value.mood]!==undefined?value.mood:'any',activity:activityTerms[value.activity]!==undefined?value.activity:'any',language:languageTerms[value.language]!==undefined?value.language:'any',era:eraTerms[value.era]!==undefined?value.era:'any',blockedArtists:Array.isArray(value.blockedArtists)?value.blockedArtists.slice(-200):[],signals:value.signals.slice(-800)};
  }
  const profile=loadProfile();
  state.flow={active:false,fetching:false,baseQuery:'',queryCursor:0,controller:null,seen:new Set(),progress:new Map(),profile};

  function saveProfile(){storage?.writeJSON?.(PROFILE_KEY,profile);updateFlowUi()}
  function trackSnapshot(track){return{id:String(track?.id||''),title:decodeText(track?.title||''),artist:decodeText(track?.artist||''),source:String(track?.source||''),at:Date.now()}}
  function record(type,track,extra={}){
    if(!track?.id)return;
    const last=profile.signals.at(-1);if(last&&last.type===type&&last.id===track.id&&Date.now()-last.at<1500)return;
    profile.signals.push({...trackSnapshot(track),type,...extra});profile.signals=profile.signals.slice(-800);saveProfile();
  }
  function signalsFor(track){const id=String(track?.id||''),artist=matchText(track?.artist);return profile.signals.filter(signal=>signal.id===id||(!signal.id&&artist&&matchText(signal.artist)===artist))}
  function latestReaction(track){return[...signalsFor(track)].reverse().find(signal=>signal.type==='like'||signal.type==='dislike')?.type||''}
  function knownIds(){return new Set([...profile.signals.map(signal=>signal.id),...state.saved.map(track=>track.id)].filter(Boolean))}
  function dislikedIds(){return new Set(profile.signals.filter(signal=>signal.type==='dislike').map(signal=>signal.id))}
  function blockedArtists(){return new Set(profile.blockedArtists.map(matchText).filter(Boolean))}
  function positiveSeeds(){
    const liked=[...profile.signals].reverse().filter(signal=>signal.type==='like'||signal.type==='complete');
    const saved=state.saved.map(track=>trackSnapshot(track));const unique=new Map();
    [...liked,...saved,state.active?trackSnapshot(state.active):null].filter(Boolean).forEach(item=>{if(item.id&&!unique.has(item.id))unique.set(item.id,item)});
    return[...unique.values()].slice(0,12);
  }
  function artistAffinity(){
    const map=new Map();for(const signal of profile.signals){const key=matchText(signal.artist);if(!key)continue;const weight={like:18,complete:9,listen30:4,play:1,skip:-7,dislike:-28}[signal.type]||0;map.set(key,(map.get(key)||0)+weight)}
    for(const track of state.saved){const key=matchText(track.artist);if(key)map.set(key,(map.get(key)||0)+12)}return map;
  }
  function sourceAffinity(){
    const map=new Map();for(const signal of profile.signals){if(!signal.source)continue;const weight={like:4,complete:3,listen30:1,skip:-2,dislike:-4}[signal.type]||0;map.set(signal.source,(map.get(signal.source)||0)+weight)}return map;
  }
  function stableNoise(track){let hash=2166136261;for(const char of `${track.id}:${profile.signals.length}`){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}return((hash>>>0)%1000)/100}
  function scoringContext(){
    const reactions=new Map();for(const signal of profile.signals){if(signal.id&&(signal.type==='like'||signal.type==='dislike'))reactions.set(signal.id,signal.type)}
    return{known:knownIds(),saved:new Set(state.saved.map(track=>track.id)),reactions,artists:artistAffinity(),sources:sourceAffinity()};
  }
  function candidateScore(track,context=scoringContext()){
    const known=context.known.has(track.id),reaction=context.reactions.get(track.id)||'',artist=matchText(track.artist);let score=Number(track.score)||50;
    score+=(context.artists.get(artist)||0)+(context.sources.get(track.source)||0)+stableNoise(track);
    if(context.saved.has(track.id))score+=42;
    if(reaction==='like')score+=70;if(reaction==='dislike')score-=1000;
    score+=profile.discovery==='familiar'?(known?34:-4):profile.discovery==='new'?(known?-55:26):(known?8:12);
    if(state.active&&artist&&artist===matchText(state.active.artist))score+=profile.discovery==='familiar'?24:profile.discovery==='new'?-22:8;
    if(Number(track.duration)>900)score-=60;if(Number(track.duration)&&Number(track.duration)<45)score-=12;
    if(state.flow.seen.has(track.id))score-=160;return score;
  }
  function rankCandidates(candidates){
    const blocked=dislikedIds(),blockedArtistKeys=blockedArtists(),context=scoringContext(),unique=new Map();candidates.forEach(track=>{if(track?.id&&track.stream_url&&!blocked.has(track.id)&&!blockedArtistKeys.has(matchText(track.artist))&&track.source!=='yandex_music'&&!unique.has(track.id))unique.set(track.id,track)});
    const sorted=[...unique.values()].sort((a,b)=>candidateScore(b,context)-candidateScore(a,context));const result=[];
    while(sorted.length){const recent=result.slice(-2).map(track=>matchText(track.artist));let index=sorted.findIndex(track=>!recent.includes(matchText(track.artist)));if(index<0)index=0;result.push(sorted.splice(index,1)[0])}
    return result;
  }
  function contextTerms(){return[moodTerms[profile.mood],activityTerms[profile.activity],languageTerms[profile.language],eraTerms[profile.era]].filter(Boolean).join(' ')}
  function revealFlowResults(){
    state.library=false;state.hasSearched=true;ui.libraryButton.classList.remove('active');ui.libraryButton.setAttribute('aria-pressed','false');ui.searchNavButton.classList.add('active');ui.searchNavButton.setAttribute('aria-pressed','true');
  }
  function buildQueries(){
    const seeds=positiveSeeds(),base=state.flow.baseQuery||ui.searchInput.value.trim(),context=contextTerms(),queries=[];
    if(base)queries.push([base,context].filter(Boolean).join(' '));
    for(const seed of seeds.slice(0,5)){
      const artist=seed.artist&&seed.artist!=='Yandex Music'?seed.artist:'';
      if(profile.discovery==='familiar'&&artist)queries.push(`${artist} ${context}`.trim());
      else if(profile.discovery==='new')queries.push(`${seed.title} ${context}`.trim());
      else queries.push(`${artist} ${seed.title} ${context}`.trim());
    }
    if(!queries.length&&context)queries.push(context);if(!queries.length)queries.push(document.documentElement.lang==='ru'?'новая музыка':'new music');return[...new Set(queries.filter(Boolean))].slice(0,4);
  }
  async function requestCandidates(query,signal){
    const sources=[...state.sources].filter(source=>!state.available.size||state.available.has(source));
    if(!sources.length)throw new Error(t('flowSearchFailed'));
    const {data}=await requestSearch({query,limit:30,sources,region:state.region,locale:navigator.language||null,fast:true},{signal});
    if(!data.tracks?.length)throw new Error(t('flowNoRecommendations'));
    return data.tracks;
  }
  async function primeLocalFlow(){
    const ranked=rankCandidates([state.active,...state.tracks,...state.saved].filter(Boolean));if(!ranked.length)return false;
    state.tracks=ranked.slice(0,80);revealFlowResults();replaceQueue(state.tracks,'context');render();
    setMessage(t('flowLive',{count:state.queue.length}),'notice');if(!state.active)void playTrack(state.tracks[0],{preserveQueue:true});return true;
  }
  async function fillFlow(initial=false){
    if(state.flow.fetching)return;state.flow.fetching=true;revealFlowResults();setMessage(t('building'),'loading');updateFlowUi();render();
    let timeoutId=null;
    try{
      if(!state.sources.size)await refreshStatus();if(!state.sources.size)throw new Error(t('flowSearchFailed'));
      const queries=buildQueries();if(!queries.length)throw new Error(t('flowNeedsSeed'));
      const query=queries[state.flow.queryCursor%queries.length];state.flow.queryCursor+=1;state.flow.controller=new AbortController();timeoutId=setTimeout(()=>state.flow.controller?.abort(),65000);
      const remote=await requestCandidates(query,state.flow.controller.signal);const current=initial?state.tracks:[];
      const ranked=rankCandidates([...current,...remote]);if(!ranked.length)throw new Error(t('flowNoRecommendations'));
      if(initial){state.tracks=ranked.slice(0,80)}else{const existing=new Set(state.tracks.map(track=>track.id));state.tracks.push(...ranked.filter(track=>!existing.has(track.id)).slice(0,40))}
      revealFlowResults();if(initial)replaceQueue(state.tracks,'context');else appendQueue(ranked,'context');render();
      if(initial&&!state.active)await playTrack(state.tracks[0],{preserveQueue:true});setMessage(t('flowLive',{count:state.queue.length}),'notice');
    }catch(error){if(error.name==='AbortError'&&(!state.flow.active||state.tracks.length))return;setMessage(error.message||t('flowUnavailable'),'error');if(initial)stopFlow(true)}
    finally{if(timeoutId)clearTimeout(timeoutId);state.flow.controller?.abort();state.flow.controller=null;state.flow.fetching=false;updateFlowUi()}
  }
  async function startFlow(){
    if(state.flow.active){stopFlow();return}
    state.flow.baseQuery=ui.searchInput.value.trim()||[state.active?.artist,state.active?.title].filter(Boolean).join(' ')||positiveSeeds()[0]?.artist||(document.documentElement.lang==='ru'?'новая музыка':'new music');
    state.flow.active=true;state.flow.queryCursor=0;state.flow.seen.clear();document.body.classList.add('flow-active');closePanel();updateFlowUi();if(await primeLocalFlow()){void fillFlow(false);return}await fillFlow(true);
  }
  function stopFlow(silent=false){state.flow.controller?.abort();state.flow.active=false;document.body.classList.remove('flow-active');updateFlowUi();if(!silent)setMessage(t('flowStopped'),'notice')}
  function openPanel(){flow.flowPanel.hidden=false;flow.flowButton.setAttribute('aria-expanded','true');document.body.classList.add('flow-screen-open');requestAnimationFrame(()=>flow.flowPanel.classList.add('open'));updateFlowUi()}
  function closePanel(){flow.flowPanel.classList.remove('open');flow.flowButton.setAttribute('aria-expanded','false');document.body.classList.remove('flow-screen-open');setTimeout(()=>{flow.flowPanel.hidden=true},180)}
  function updateFlowUi(){
    flow.flowBadge.textContent=t(state.flow.fetching?'building':state.flow.active?'live':'ready');flow.flowButton.classList.toggle('active',state.flow.active);flow.flowStart.textContent=t(state.flow.active?'stopWave':'startWave');flow.flowStart.classList.toggle('stop',state.flow.active);flow.flowStats.textContent=t('flowStats',{signals:profile.signals.length,blocked:profile.blockedArtists.length});
    flow.flowMood.value=profile.mood;flow.flowActivity.value=profile.activity;flow.flowLanguage.value=profile.language;flow.flowEra.value=profile.era;flow.flowDiscovery.querySelectorAll('[data-flow-discovery]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.flowDiscovery===profile.discovery)));
    const seed=state.active?[decodeText(state.active.artist),decodeText(state.active.title)].filter(Boolean).join(' — '):ui.searchInput.value.trim()||positiveSeeds()[0]?.artist||t('currentSearchOrLibrary');flow.flowSeed.textContent=t('flowSeed',{seed});
    const reaction=state.active?latestReaction(state.active):'';flow.flowLike.classList.toggle('active',reaction==='like');flow.flowDislike.classList.toggle('active',reaction==='dislike');
  }
  function likeCurrent(){if(!state.active)return;record('like',state.active);if(!state.saved.some(track=>track.id===state.active.id))toggleSave(state.active);updateFlowUi();setMessage(t('liked'),'notice')}
  function dislikeCurrent(){
    if(!state.active)return;const rejected=state.active;record('dislike',rejected);const next=state.tracks.find(track=>track.id!==rejected.id&&!dislikedIds().has(track.id));state.tracks=state.tracks.filter(track=>track.id!==rejected.id);render();if(next)playTrack(next);if(state.flow.active)fillFlow(false);setMessage(t('disliked'),'notice')
  }
  function blockCurrentArtist(){
    if(!state.active?.artist)return;const artist=decodeText(state.active.artist),key=matchText(artist);if(!key||profile.blockedArtists.some(value=>matchText(value)===key))return;
    profile.blockedArtists.push(artist);saveProfile();const rejected=state.active;state.tracks=state.tracks.filter(track=>matchText(track.artist)!==key);render();const next=state.tracks.find(track=>track.id!==rejected.id);if(next)playTrack(next);if(state.flow.active)fillFlow(false);setMessage(t('artistBlocked',{artist}),'notice');
  }
  function trackProgress(){
    const track=state.active;if(!track)return;const current=track.source==='youtube'?state.youtube?.getCurrentTime?.():ui.audio.currentTime;const duration=track.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;if(!duration||!Number.isFinite(current))return;
    const ratio=current/duration,previous=state.flow.progress.get(track.id)||0;state.flow.progress.set(track.id,Math.max(previous,ratio));if(ratio>=.3&&previous<.3)record('listen30',track,{progress:.3});if(ratio>=.8&&previous<.8)record('complete',track,{progress:.8});
  }

  flow.flowButton.addEventListener('click',()=>flow.flowPanel.hidden?openPanel():closePanel());flow.flowClose.addEventListener('click',closePanel);flow.flowStart.addEventListener('click',startFlow);flow.flowLike.addEventListener('click',likeCurrent);flow.flowDislike.addEventListener('click',dislikeCurrent);flow.flowBlockArtist.addEventListener('click',blockCurrentArtist);
  flow.flowMood.addEventListener('change',()=>{profile.mood=flow.flowMood.value;saveProfile();if(state.flow.active)fillFlow(false)});flow.flowActivity.addEventListener('change',()=>{profile.activity=flow.flowActivity.value;saveProfile();if(state.flow.active)fillFlow(false)});
  flow.flowLanguage.addEventListener('change',()=>{profile.language=flow.flowLanguage.value;saveProfile();if(state.flow.active)fillFlow(false)});flow.flowEra.addEventListener('change',()=>{profile.era=flow.flowEra.value;saveProfile();if(state.flow.active)fillFlow(false)});
  flow.flowDiscovery.addEventListener('click',event=>{const button=event.target.closest('[data-flow-discovery]');if(!button)return;profile.discovery=button.dataset.flowDiscovery;saveProfile();if(state.flow.active)fillFlow(false)});
  flow.flowReset.addEventListener('click',()=>{if(!confirm(t('resetConfirm')))return;Object.assign(profile,freshProfile());saveProfile();updateFlowUi();setMessage(t('tasteReset'),'notice')});
  document.addEventListener('awun:play',event=>{const track=event.detail.track;state.flow.seen.add(track.id);state.flow.progress.set(track.id,0);record('play',track);updateFlowUi();if(state.flow.active){const index=state.tracks.findIndex(item=>item.id===track.id);if(index<0||index>=state.tracks.length-7)fillFlow(false)}});
  document.addEventListener('awun:skip',event=>{const track=event.detail.track;if(!track)return;record('skip',track,{progress:Math.round((state.flow.progress.get(track.id)||0)*100)/100})});document.addEventListener('awun:complete',event=>record('complete',event.detail.track,{progress:1}));document.addEventListener('awun:library',updateFlowUi);
  document.addEventListener('awun:language',updateFlowUi);
  setInterval(trackProgress,2000);updateFlowUi();
})();
