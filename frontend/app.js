const sourceLabels={youtube:'YouTube',soundcloud:'SoundCloud',audius:'Audius',jamendo:'Jamendo',internet_archive:'Internet Archive',yandex_music:'Yandex Music'};
const regions=['AUTO','CIS','EUROPE','USA','LATAM','ASIA','GLOBAL'];
const resultLimits=[30,60,100];
const i18n=window.awunI18n;
const playerCore=window.awunPlayerCore;
const t=(key,values={})=>i18n.t(key,values);
const $=id=>document.getElementById(id);
const runtimeParams=new URLSearchParams(location.search);
const runtimePlatform=runtimeParams.get('platform')||'web';
const playStoreMode=runtimePlatform==='android-play';
function runtimeApiBase(name){
  const candidate=(runtimeParams.get(name)||'').trim();
  if(!candidate)return'';
  try{
    const parsed=new URL(candidate);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.search||parsed.hash)return'';
    if(parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))return'';
    return parsed.href.replace(/\/+$/,'');
  }catch{return''}
}
const apiBase=runtimeApiBase('api');
const fallbackApiBase=runtimeApiBase('fallback_api');
document.documentElement.dataset.platform=runtimePlatform;
const remoteRetryStatuses=new Set([502,503,504]);
const remoteFallbackTimeoutMs=60000;
function endpointUrl(base,input){return base&&typeof input==='string'&&input.startsWith('/')?`${base}${input}`:input}
function apiUrl(input){return endpointUrl(apiBase,input)}
function fallbackApiUrl(input){return endpointUrl(fallbackApiBase,input)}
function requestOptions(init={}){
  const headers=new Headers(init.headers||{});
  if(playStoreMode)headers.set('X-AWUN-Client','android-play');
  return{...init,headers};
}
function awunFetch(input,init={}){
  const options=requestOptions(init);
  const target=apiUrl(input);
  if(apiBase&&target!==input&&typeof input==='string'){
    return fetch(target,options).then(response=>remoteRetryStatuses.has(response.status)?fetch(input,options):response).catch(()=>fetch(input,options));
  }
  if(fallbackApiBase&&typeof input==='string'&&input.startsWith('/')){
    return fetch(input,options).then(response=>remoteRetryStatuses.has(response.status)?fetch(fallbackApiUrl(input),options):response).catch(()=>fetch(fallbackApiUrl(input),options));
  }
  return fetch(target,options);
}

async function fetchHealthCandidate(url,origin,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=performance.now();
  try{
    const response=await fetch(url,requestOptions({cache:'no-store',signal:controller.signal}));
    if(!response.ok)throw new Error(t('healthFailed'));
    return{data:await response.json(),origin,endpoint_latency_ms:Math.round(performance.now()-started),checked_at:new Date().toISOString()};
  }finally{clearTimeout(timer)}
}
async function requestHealthSnapshot(){
  const candidates=[];
  if(apiBase)candidates.push({url:apiUrl('/health'),origin:'configured',timeout:8000});
  else candidates.push({url:'/health',origin:runtimePlatform==='desktop'?'local':'current',timeout:8000});
  if(fallbackApiBase)candidates.push({url:fallbackApiUrl('/health'),origin:'fallback',timeout:remoteFallbackTimeoutMs});
  if(apiBase&&typeof location.origin==='string'&&location.origin.startsWith('http'))candidates.push({url:'/health',origin:'current',timeout:8000});
  let failure;
  for(const candidate of candidates){
    try{return await fetchHealthCandidate(candidate.url,candidate.origin,candidate.timeout)}
    catch(error){failure=error}
  }
  throw failure||new Error(t('healthFailed'));
}

function trackSessionKey(track){return `${track?.source||''}:${track?.id||''}`}
const freshTracksByKey=new Map();
function markFreshTracks(tracks){(Array.isArray(tracks)?tracks:[]).forEach(track=>freshTracksByKey.set(trackSessionKey(track),track))}
async function readSearchData(response){
  const data=await response.json();
  if(!response.ok)throw new Error(data.detail||t('searchFailed'));
  markFreshTracks(data.tracks);
  return data;
}
function mergeSearchData(primary,fallback,requestedSources=[]){
  if(!fallback)return primary;
  const tracks=playerCore.uniqueTracks([...(primary.tracks||[]),...(fallback.tracks||[])]);
  const errors={...(primary.errors||{})};
  requestedSources.forEach(source=>{if(fallback.errors?.[source])errors[source]=fallback.errors[source];else delete errors[source]});
  return{...primary,tracks,total:tracks.length,searched_sources:[...new Set([...(primary.searched_sources||[]),...(fallback.searched_sources||[])])],query_variants:[...new Set([...(primary.query_variants||[]),...(fallback.query_variants||[])])],errors,elapsed_ms:Math.max(Number(primary.elapsed_ms)||0,Number(fallback.elapsed_ms)||0)};
}
function fallbackSearch(payload,signal){
  const controller=new AbortController();
  const relayAbort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)relayAbort();else signal?.addEventListener('abort',relayAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(),remoteFallbackTimeoutMs);
  const options=requestOptions({method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify(payload)});
  return fetch(fallbackApiUrl('/api/v1/search'),options).then(readSearchData).catch(error=>{
    if(error?.name==='AbortError'&&!signal?.aborted)throw new Error(t('searchUnavailable'));
    throw error;
  }).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',relayAbort)});
}
async function requestSearch(payload,{signal,waitForFallback=false}={}){
  const options=requestOptions({method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(payload)});
  if(!fallbackApiBase||apiBase){return{data:await readSearchData(await awunFetch('/api/v1/search',options)),supplement:null}}
  let local;
  try{local=await readSearchData(await fetch('/api/v1/search',options))}
  catch(error){if(error?.name==='AbortError')throw error;return{data:await fallbackSearch(payload,signal),supplement:null}}
  const requested=Array.isArray(payload.sources)?payload.sources:[];
  const failed=requested.filter(source=>Object.prototype.hasOwnProperty.call(local.errors||{},source));
  if(!failed.length)return{data:local,supplement:null};
  const remote=fallbackSearch({...payload,sources:failed},signal).then(data=>mergeSearchData(local,data,failed));
  if(waitForFallback||!(local.tracks||[]).length){
    try{return{data:(await remote)||local,supplement:null}}
    catch(error){if(error?.name==='AbortError'&&signal?.aborted)throw error;return{data:local,supplement:null}}
  }
  return{data:local,supplement:remote.catch(()=>null)};
}
const ui={
  status:$('status'),searchNavButton:$('searchNavButton'),libraryButton:$('libraryButton'),allSourcesButton:$('allSourcesButton'),installButton:$('installButton'),languageButton:$('languageButton'),languageLabel:$('languageLabel'),emptyGuide:$('emptyGuide'),idleStage:$('idleStage'),idleSearchButton:$('idleSearchButton'),idleWaveButton:$('idleWaveButton'),guideSearch:$('guideSearch'),guideWave:$('guideWave'),guideImport:$('guideImport'),searchForm:$('searchForm'),searchInput:$('searchInput'),searchButton:$('searchButton'),homeSections:$('homeSections'),recentList:$('recentList'),recommendationGrid:$('recommendationGrid'),queueList:$('queueList'),queueEmpty:$('queueEmpty'),clearQueue:$('clearQueue'),
  sources:$('sources'),regionSelect:$('regionSelect'),limitSelect:$('limitSelect'),results:$('results'),trackList:$('trackList'),message:$('message'),resultTitle:$('resultTitle'),resultCount:$('resultCount'),resultTime:$('resultTime'),searchMeta:$('searchMeta'),
  player:$('player'),playerArtwork:$('playerArtwork'),nowTitle:$('nowTitle'),nowArtist:$('nowArtist'),nowSource:$('nowSource'),audio:$('audio'),youtubeDock:$('youtubeDock'),youtubePlayer:$('youtubePlayer'),
  previousTrack:$('previousTrack'),playPause:$('playPause'),nextTrack:$('nextTrack'),repeatMode:$('repeatMode'),waveProgress:$('waveProgress'),progress:$('progress'),elapsed:$('elapsed'),totalTime:$('totalTime'),volume:$('volume'),muteButton:$('muteButton'),closePlayer:$('closePlayer'),minimizeVideo:$('minimizeVideo'),queueToggle:$('queueToggle'),queueClose:$('queueClose'),expandPlayer:$('expandPlayer'),collapsePlayer:$('collapsePlayer'),
  themeButton:$('themeButton'),themeLabel:$('themeLabel'),themePanel:$('themePanel'),themeClose:$('themeClose'),themeBackdrop:$('themeBackdrop'),themeColor:$('themeColor'),motionToggle:$('motionToggle'),motionValue:$('motionValue'),decorToggle:$('decorToggle'),decorValue:$('decorValue'),densityToggle:$('densityToggle'),densityValue:$('densityValue'),telemetryClock:$('telemetryClock'),diagnosticsButton:$('diagnosticsButton'),diagnosticsPanel:$('diagnosticsPanel'),diagnosticsClose:$('diagnosticsClose'),diagnosticsRefresh:$('diagnosticsRefresh'),diagnosticsCopy:$('diagnosticsCopy'),diagnosticsList:$('diagnosticsList'),diagnosticsEndpoint:$('diagnosticsEndpoint'),diagnosticsChecked:$('diagnosticsChecked'),diagnosticsCopyStatus:$('diagnosticsCopyStatus'),
  importButton:$('importButton'),importPanel:$('importPanel'),importClose:$('importClose'),importBackdrop:$('importBackdrop'),libraryFile:$('libraryFile'),importFileButton:$('importFileButton'),importFileName:$('importFileName'),importText:$('importText'),importStatus:$('importStatus'),importSubmit:$('importSubmit'),importUrl:$('importUrl'),importUrlSubmit:$('importUrlSubmit'),importProgress:$('importProgress')
};

function loadLibrary(){try{const value=JSON.parse(localStorage.getItem('awun-library')||'[]');return Array.isArray(value)?value:[]}catch{return[]}}
function loadRegion(){const value=localStorage.getItem('awun-region')||'AUTO';return regions.includes(value)?value:'AUTO'}
function loadResultLimit(){const value=Number(localStorage.getItem('awun-result-limit')||60);return resultLimits.includes(value)?value:60}
function loadRepeatMode(){const value=localStorage.getItem('awun-repeat-mode')||'off';return ['off','all','one'].includes(value)?value:'off'}
function loadRecents(){try{const value=JSON.parse(localStorage.getItem('awun-recent')||'[]');return Array.isArray(value)?value.filter(item=>item&&item.id):[]}catch{return[]}}
function loadQueueState(){
  try{
    const value=JSON.parse(localStorage.getItem('awun-queue-v1')||'{}');
    const items=Array.isArray(value)?value:value.items;
    return{items:playerCore.uniqueTracks(items),mode:value.mode==='manual'?'manual':'context'};
  }catch{return{items:[],mode:'context'}}
}
function loadVisual(){try{const value=JSON.parse(localStorage.getItem('awun-visual')||'{}');return{theme:['black','white','acid','ultraviolet','cobalt','ember'].includes(value.theme)?value.theme:'black',motion:value.motion==='off'?'off':'on',decor:value.decor==='minimal'?'minimal':'full',density:['compact','standard','airy'].includes(value.density)?value.density:'standard'}}catch{return{theme:'black',motion:'on',decor:'full',density:'standard'}}}
function loadLineComments(){try{const value=JSON.parse(localStorage.getItem('awun-line-comments-v1')||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return{}}}
const visualThemes={black:{labelKey:'themeBlackShort',color:'#050505'},white:{labelKey:'themeWhiteShort',color:'#e7e8df'},acid:{labelKey:'themeAcidShort',color:'#050a05'},ultraviolet:{labelKey:'themeUltravioletShort',color:'#07050c'},cobalt:{labelKey:'themeCobaltShort',color:'#040a0e'},ember:{labelKey:'themeEmberShort',color:'#080704'}};
const restoredQueue=loadQueueState();
const state={
  tracks:[],saved:loadLibrary(),recents:loadRecents(),queue:restoredQueue.items,queueMode:restoredQueue.mode,available:new Set(),sources:new Set(),region:loadRegion(),resultLimit:loadResultLimit(),repeatMode:loadRepeatMode(),library:false,hasSearched:false,active:null,controller:null,
  youtube:null,youtubeApi:null,youtubeTicker:null,hls:null,audioGraph:null,waveformCapture:null,waveformCaptureFrame:null,seeking:false,recoveringGeneration:null,sameSourceRefreshGeneration:null,playbackGeneration:0,audioTrackId:null,failedSources:new Set(),playbackOrigin:null,playbackPosition:0,lastVolume:.82,expanded:null,details:new Map(),detailsController:null,openLines:new Set(),lineComments:loadLineComments(),geniusEnabled:false,diagnostics:null,...loadVisual()
};
let installPrompt=null;
let language=i18n.language;
function applyLanguage(){language=i18n.language;i18n.apply();applyVisual(false);applyRepeatMode(false);render();renderDiagnostics();refreshStatus()}

function emitAwun(type,detail={}){document.dispatchEvent(new CustomEvent(`awun:${type}`,{detail}))}

const formatTime=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
const decodeText=value=>{const node=document.createElement('textarea');node.innerHTML=String(value||'');return node.value};
const safeImage=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return''}};
const currentList=()=>state.library?state.saved:state.tracks;
const selectedIds=()=>new Set(state.saved.map(track=>track.id));
const waveformKey=track=>[track?.source,track?.id,track?.artist,track?.title,track?.duration].filter(value=>value!==undefined&&value!==null).join('|')||'awun';
const waveformCacheKey='awun-waveforms-v1';
const waveformLoads=new Map();
const waveformTargets=new WeakMap();
let waveformObserver=null;
function loadWaveformCache(){
  try{const value=JSON.parse(localStorage.getItem(waveformCacheKey)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
  catch{return{}}
}
const waveformCache=loadWaveformCache();
function waveformEntry(track){
  const embedded=Array.isArray(track?.waveform_peaks)?track.waveform_peaks:null;
  if(embedded?.length)return{peaks:embedded,origin:'provider',coverage:1};
  return waveformCache[waveformKey(track)]||null;
}
function cachedWaveform(track){const entry=waveformEntry(track),peaks=entry?.peaks;return Array.isArray(peaks)&&peaks.length>=16?peaks:null}
function storeWaveform(track,peaks,{origin='provider',captured=null,coverage=1}={}){
  const normalized=playerCore.waveformPeaks(peaks,180);if(normalized.length<16)return;
  waveformCache[waveformKey(track)]={peaks:normalized,origin,coverage:Math.max(0,Math.min(1,Number(coverage)||0)),captured:Array.isArray(captured)?captured.map(value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)))):undefined,updated_at:Date.now()};
  const entries=Object.entries(waveformCache).sort((left,right)=>(right[1]?.updated_at||0)-(left[1]?.updated_at||0));
  entries.slice(160).forEach(([key])=>delete waveformCache[key]);
  try{localStorage.setItem(waveformCacheKey,JSON.stringify(waveformCache))}catch{}
}
function waveformImagePeaks(url){
  return new Promise((resolve,reject)=>{
    const image=new Image();image.crossOrigin='anonymous';image.decoding='async';
    image.onerror=()=>reject(new Error('waveform image unavailable'));
    image.onload=()=>{
      try{
        const width=180,height=80,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('canvas unavailable');
        context.clearRect(0,0,width,height);context.drawImage(image,0,0,width,height);
        const pixels=context.getImageData(0,0,width,height).data;
        const corner=[pixels[0],pixels[1],pixels[2],pixels[3]],transparent=corner[3]<24;
        const peaks=[];
        for(let x=0;x<width;x+=1){
          let top=height,bottom=-1;
          for(let y=0;y<height;y+=1){
            const index=(y*width+x)*4,alpha=pixels[index+3];
            const difference=Math.abs(pixels[index]-corner[0])+Math.abs(pixels[index+1]-corner[1])+Math.abs(pixels[index+2]-corner[2]);
            if((transparent&&alpha>28)||(!transparent&&alpha>28&&difference>36)){top=Math.min(top,y);bottom=Math.max(bottom,y)}
          }
          peaks.push(bottom>=top?Math.round(((bottom-top+1)/height)*100):0);
        }
        const useful=peaks.filter(value=>value>=8).length;
        if(useful<width*.2||peaks.filter(value=>value>=96).length>width*.85)throw new Error('waveform image has no usable alpha profile');
        resolve(peaks);
      }catch(error){reject(error)}
    };
    image.src=url;
  });
}
async function hydrateWaveform(element,track,bars){
  const url=safeImage(track?.waveform_url);if(!url||cachedWaveform(track))return;
  const key=waveformKey(track);
  let pending=waveformLoads.get(key);
  if(!pending){pending=waveformImagePeaks(url).then(peaks=>{storeWaveform(track,peaks,{origin:'provider'});return peaks}).finally(()=>waveformLoads.delete(key));waveformLoads.set(key,pending)}
  try{const peaks=await pending;if(element.isConnected){element.style.setProperty('--wave-mask',playerCore.waveformMaskFromPeaks(peaks,bars));element.dataset.waveform='provider'}}catch{}
}
function scheduleWaveformHydration(element,track,bars){
  if(!element||!track?.waveform_url||cachedWaveform(track))return;
  waveformTargets.set(element,{track,bars});
  if(!('IntersectionObserver'in window)){void hydrateWaveform(element,track,bars);return}
  if(!waveformObserver)waveformObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;waveformObserver.unobserve(entry.target);const target=waveformTargets.get(entry.target);if(target)void hydrateWaveform(entry.target,target.track,target.bars)}),{rootMargin:'160px'});
  waveformObserver.observe(element);
}
function applyWaveform(element,track,bars=96){
  if(!element)return;
  const peaks=cachedWaveform(track),provider=safeImage(track?.waveform_url);
  if(peaks){element.style.setProperty('--wave-mask',playerCore.waveformMaskFromPeaks(peaks,bars));element.dataset.waveform='provider';return}
  if(provider){element.style.setProperty('--wave-mask',`url("${provider}")`);element.dataset.waveform='provider';scheduleWaveformHydration(element,track,bars);return}
  element.style.setProperty('--wave-mask',playerCore.waveformMask(waveformKey(track),bars));element.dataset.waveform='synthetic';
}

function sameOriginMedia(track){try{return new URL(track?.stream_url,location.href).origin===location.origin}catch{return false}}
function capturedWaveform(track,captured){
  const fallback=playerCore.waveformBars(waveformKey(track),180);
  return fallback.map((value,index)=>captured[index]>0?captured[index]:value);
}
function updateCapturedWaveform(track,captured){
  const peaks=capturedWaveform(track,captured),active=document.querySelector('.track.active .track-waveform'),home=document.querySelector('.home-track-card.active .home-track-meter');
  if(active){active.style.setProperty('--wave-mask',playerCore.waveformMaskFromPeaks(peaks,74));active.dataset.waveform='captured'}
  if(home){home.style.setProperty('--wave-mask',playerCore.waveformMaskFromPeaks(peaks,58));home.dataset.waveform='captured'}
  if(state.active?.id===track.id){ui.waveProgress.style.setProperty('--wave-mask',playerCore.waveformMaskFromPeaks(peaks,132));ui.waveProgress.dataset.waveform='captured'}
}
function saveCapturedWaveform(){
  const capture=state.waveformCapture;if(!capture)return;
  const sampled=capture.peaks.filter(value=>value>0).length;if(sampled<3)return;
  const coverage=sampled/capture.peaks.length,peaks=capturedWaveform(capture.track,capture.peaks);
  storeWaveform(capture.track,peaks,{origin:'captured',captured:capture.peaks,coverage});updateCapturedWaveform(capture.track,capture.peaks);capture.savedAt=performance.now();
}
function stopWaveformCapture(save=true){
  if(state.waveformCaptureFrame)cancelAnimationFrame(state.waveformCaptureFrame);state.waveformCaptureFrame=null;
  if(save)saveCapturedWaveform();state.waveformCapture=null;
}
function startWaveformCapture(track){
  if(!track||track.source==='youtube'||track.waveform_url||!sameOriginMedia(track))return;
  const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
  const entry=waveformEntry(track);if(entry?.origin==='provider'||Number(entry?.coverage)>=.9)return;
  try{
    if(!state.audioGraph){const mediaStream=ui.audio.captureStream?.()||ui.audio.mozCaptureStream?.();if(!mediaStream)return;const context=new Context(),analyser=context.createAnalyser(),source=context.createMediaStreamSource(mediaStream),silent=context.createGain();analyser.fftSize=1024;analyser.smoothingTimeConstant=.66;silent.gain.value=0;source.connect(analyser);analyser.connect(silent);silent.connect(context.destination);state.audioGraph={context,analyser,source,silent,buffer:new Uint8Array(analyser.fftSize)}}
    void state.audioGraph.context.resume();
  }catch{return}
  stopWaveformCapture(false);
  const stored=Array.isArray(entry?.captured)?entry.captured.slice(0,180):[],peaks=Array.from({length:180},(_,index)=>stored[index]||0);
  state.waveformCapture={track,peaks,savedAt:performance.now()};
  const sample=()=>{
    const capture=state.waveformCapture,graph=state.audioGraph;if(!capture||!graph||state.active?.id!==track.id)return;
    if(!ui.audio.paused&&Number.isFinite(ui.audio.duration)&&ui.audio.duration>0){
      graph.analyser.getByteTimeDomainData(graph.buffer);let amplitude=0;for(const value of graph.buffer)amplitude=Math.max(amplitude,Math.abs(value-128)/128);
      const index=Math.min(179,Math.max(0,Math.floor((ui.audio.currentTime/ui.audio.duration)*180))),height=Math.max(8,Math.min(100,Math.round(amplitude*145)));
      capture.peaks[index]=Math.max(capture.peaks[index],height);
      if(performance.now()-capture.savedAt>10000)saveCapturedWaveform();else if(index%3===0)updateCapturedWaveform(track,capture.peaks);
    }
    state.waveformCaptureFrame=requestAnimationFrame(sample);
  };
  state.waveformCaptureFrame=requestAnimationFrame(sample);
}

function persist(){
  localStorage.setItem('awun-library',JSON.stringify(state.saved));
  localStorage.setItem('awun-recent',JSON.stringify(state.recents.slice(0,12)));
  persistQueue();
  ui.libraryButton.querySelector('b').textContent=String(state.saved.length).padStart(2,'0');
}

function persistQueue(){
  state.queue=playerCore.uniqueTracks(state.queue);
  localStorage.setItem('awun-queue-v1',JSON.stringify({version:1,mode:state.queueMode,items:state.queue}));
}

function setMessage(text='',kind=''){
  ui.message.textContent=text;
  ui.message.className=`message ${kind}`.trim();
}

function applyVisual(save=true){
  const theme=visualThemes[state.theme]||visualThemes.acid;
  document.documentElement.dataset.theme=state.theme;
  document.documentElement.dataset.motion=state.motion;
  document.documentElement.dataset.decor=state.decor;
  document.documentElement.dataset.density=state.density;
  ui.themeLabel.textContent=t(theme.labelKey);
  ui.themeColor.content=theme.color;
  ui.motionValue.textContent=t(state.motion==='on'?'on':'off');
  ui.decorValue.textContent=t(state.decor==='minimal'?'minimal':'editorial');
  ui.densityValue.textContent=t(state.density);
  ui.motionToggle.setAttribute('aria-pressed',String(state.motion==='on'));
  ui.decorToggle.setAttribute('aria-pressed',String(state.decor==='minimal'));
  ui.densityToggle.dataset.value=state.density;
  document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===state.theme)));
  if(save)localStorage.setItem('awun-visual',JSON.stringify({theme:state.theme,motion:state.motion,decor:state.decor,density:state.density}));
}

function openThemePanel(){setQueueOpen(false);setPlayerExpanded(false);if(document.body.classList.contains('flow-screen-open'))document.getElementById('flowClose')?.click();ui.importPanel.hidden=true;ui.importBackdrop.hidden=true;ui.importButton.setAttribute('aria-expanded','false');ui.diagnosticsPanel.hidden=true;ui.diagnosticsButton.setAttribute('aria-expanded','false');ui.themePanel.hidden=false;ui.themeBackdrop.hidden=false;ui.themeButton.setAttribute('aria-expanded','true');requestAnimationFrame(()=>document.body.classList.add('visual-open'))}
function closeThemePanel(){document.body.classList.remove('visual-open');ui.themeButton.setAttribute('aria-expanded','false');ui.diagnosticsButton.setAttribute('aria-expanded','false');setTimeout(()=>{ui.themePanel.hidden=true;ui.diagnosticsPanel.hidden=true;ui.themeBackdrop.hidden=true},180)}
function openDiagnosticsPanel(){setQueueOpen(false);setPlayerExpanded(false);ui.themePanel.hidden=true;ui.themeButton.setAttribute('aria-expanded','false');ui.diagnosticsPanel.hidden=false;ui.diagnosticsButton.setAttribute('aria-expanded','true');ui.themeBackdrop.hidden=false;renderDiagnostics();requestAnimationFrame(()=>document.body.classList.add('visual-open'));void refreshStatus()}
function openImportPanel(){ui.themePanel.hidden=true;ui.diagnosticsPanel.hidden=true;ui.themeBackdrop.hidden=true;ui.themeButton.setAttribute('aria-expanded','false');ui.importPanel.hidden=false;ui.importBackdrop.hidden=false;ui.importButton.setAttribute('aria-expanded','true');requestAnimationFrame(()=>document.body.classList.add('visual-open'))}
function closeImportPanel(){document.body.classList.remove('visual-open');ui.importButton.setAttribute('aria-expanded','false');setTimeout(()=>{ui.importPanel.hidden=true;ui.importBackdrop.hidden=true},180)}
function setQueueOpen(open){
  const next=Boolean(open);ui.player.classList.toggle('queue-open',next);document.body.classList.toggle('queue-open',next);ui.queueToggle?.setAttribute('aria-expanded',String(next));
}
function setPlayerExpanded(open){
  const next=Boolean(open);if(next)setQueueOpen(false);ui.player.classList.toggle('expanded-player',next);document.body.classList.toggle('player-expanded',next);ui.expandPlayer?.setAttribute('aria-expanded',String(next));
}
function updateClock(){ui.telemetryClock.textContent=new Intl.DateTimeFormat(language==='ru'?'ru-RU':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())}

function yandexCatalogLink(artist,title){return `https://music.yandex.ru/search?text=${encodeURIComponent(`${artist||''} ${title||''}`.trim())}`}
function importKey(artist,title){return `${String(artist||'').trim().toLocaleLowerCase()}\u0000${String(title||'').trim().toLocaleLowerCase()}`}
function importId(artist,title){let hash=2166136261;for(const character of importKey(artist,title)){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619)}return `ym_${(hash>>>0).toString(36)}`}
function splitImportedName(value){
  const clean=String(value||'').replace(/^\s*\d+[.)]\s*/,'').trim();
  const parts=clean.split(/\s+(?:—|–|-|\|)\s+|\t+/);
  if(parts.length<2)return{artist:'',title:clean};
  return{artist:parts.shift().trim(),title:parts.join(' — ').trim()};
}
function importedTrack(artist,title){
  artist=String(artist||'').trim();title=String(title||'').trim();
  if(!title)return null;
  return{id:importId(artist,title),title,artist:artist||'Yandex Music',duration:0,quality:'YM',source:'yandex_music',stream_url:'',download_url:null,thumbnail:null,import_origin:'yandex_music',catalog_links:{yandex_music:yandexCatalogLink(artist,title)}};
}
function parseDelimitedLine(line,delimiter){
  const values=[];let current='',quoted=false;
  for(let index=0;index<line.length;index+=1){const character=line[index];if(character==='"'){if(quoted&&line[index+1]==='"'){current+='"';index+=1}else quoted=!quoted}else if(character===delimiter&&!quoted){values.push(current.trim());current=''}else current+=character}
  values.push(current.trim());return values;
}
function parseJsonLibrary(raw){
  const payload=JSON.parse(raw);const entries=Array.isArray(payload)?payload:payload.tracks||payload.items||payload.playlist?.tracks||payload.result?.tracks||[];
  if(!Array.isArray(entries))return[];
  return entries.map(entry=>{const item=entry?.track||entry||{};const title=item.title||item.name||item.track||item.trackName||'';let artist=item.artist||item.artist_name||item.artistName||'';if(Array.isArray(item.artists))artist=item.artists.map(value=>typeof value==='string'?value:value?.name).filter(Boolean).join(', ');else if(artist&&typeof artist==='object')artist=artist.name||'';return importedTrack(artist,title)}).filter(Boolean);
}
function parseCsvLibrary(raw){
  const lines=raw.split(/\r?\n/).filter(line=>line.trim());if(!lines.length)return[];
  const delimiter=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':lines[0].includes('\t')?'\t':',';
  const headers=parseDelimitedLine(lines[0],delimiter).map(value=>value.toLocaleLowerCase().replace(/[\s_-]/g,''));
  const titleIndex=headers.findIndex(value=>['title','track','tracktitle','name','song'].includes(value));
  const artistIndex=headers.findIndex(value=>['artist','artists','artistname','performer','author'].includes(value));
  const hasHeader=titleIndex>=0||artistIndex>=0;const start=hasHeader?1:0;
  return lines.slice(start).map(line=>{const values=parseDelimitedLine(line,delimiter);const title=values[titleIndex>=0?titleIndex:0]||'';const artist=values[artistIndex>=0?artistIndex:1]||'';return importedTrack(artist,title)}).filter(Boolean);
}
function parseM3uLibrary(raw){return raw.split(/\r?\n/).filter(line=>/^#EXTINF:/i.test(line)).map(line=>splitImportedName(line.slice(line.indexOf(',')+1))).map(({artist,title})=>importedTrack(artist,title)).filter(Boolean)}
function parseTextLibrary(raw){return raw.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(splitImportedName).map(({artist,title})=>importedTrack(artist,title)).filter(Boolean)}
function parseImportedLibrary(raw,fileName=''){
  const extension=fileName.toLocaleLowerCase().split('.').pop();let tracks=[];
  if(extension==='json'||/^[\s\n]*[\[{]/.test(raw)){try{tracks=parseJsonLibrary(raw)}catch{if(extension==='json')throw new Error(t('jsonInvalid'))}}
  if(!tracks.length&&(extension==='m3u'||extension==='m3u8'||/#EXTINF:/i.test(raw)))tracks=parseM3uLibrary(raw);
  if(!tracks.length&&(extension==='csv'||/\b(?:artist|performer)[,;\t].*(?:title|track|name)/i.test(raw.split(/\r?\n/)[0]||'')))tracks=parseCsvLibrary(raw);
  if(!tracks.length)tracks=parseTextLibrary(raw);
  const unique=new Map();tracks.forEach(track=>unique.set(importKey(track.artist==='Yandex Music'?'':track.artist,track.title),track));return [...unique.values()].slice(0,1000);
}
async function importLibrary(){
  try{
    const tracks=parseImportedLibrary(ui.importText.value,ui.libraryFile.files?.[0]?.name||'');if(!tracks.length)throw new Error(t('noImportEntries'));
    await matchAndSaveImported(tracks);
  }catch(error){ui.importStatus.textContent=error.message||t('importFailed')}
}

function setRange(range,value){
  const min=Number(range.min)||0,max=Number(range.max)||100;
  const percent=Math.max(0,Math.min(100,((Number(value)-min)/(max-min))*100));
  range.value=String(value);
  range.style.setProperty('--value',`${percent}%`);
  if(range.classList.contains('progress'))range.parentElement?.style.setProperty('--value',`${percent}%`);
}

function sourceButtons(){return [...document.querySelectorAll('[data-source]')]}

const diagnosticSources=['soundcloud','youtube','audius','jamendo','internet_archive'];
function diagnosticOrigin(origin){return t({local:'diagnosticLocalApi',fallback:'diagnosticFallbackApi',configured:'diagnosticConfiguredApi',current:'diagnosticCurrentApi'}[origin]||'diagnosticUnknownApi')}
function diagnosticTime(value){
  if(!value)return t('diagnosticNever');
  const date=new Date(value);if(Number.isNaN(date.getTime()))return t('diagnosticNever');
  return new Intl.DateTimeFormat(language==='ru'?'ru-RU':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'2-digit'}).format(date);
}
function renderDiagnostics(){
  if(!ui.diagnosticsList)return;
  const snapshot=state.diagnostics,data=snapshot?.data||{},health=data.source_health||{},available=new Set(data.sources||[]);
  ui.diagnosticsEndpoint.textContent=snapshot?`${diagnosticOrigin(snapshot.origin)} · ${snapshot.endpoint_latency_ms??'—'} ${t('millisecondsShort')}`:t('diagnosticChecking');
  ui.diagnosticsChecked.textContent=snapshot?.checked_at?diagnosticTime(snapshot.checked_at):t('diagnosticNever');
  ui.diagnosticsList.replaceChildren();
  diagnosticSources.forEach(source=>{
    const provider=data.providers?.[source]||{},sample=health[source]||{},enabled=available.has(source)&&provider.enabled!==false;
    const status=snapshot?.error?'unavailable':enabled?(sample.status||'unknown'):'disabled';
    const row=document.createElement('article');row.className=`diagnostic-source ${status}`;
    const head=document.createElement('div');const identity=document.createElement('div');const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');const name=document.createElement('strong');name.textContent=sourceLabels[source]||source;identity.append(dot,name);const badge=document.createElement('span');badge.textContent=t(`diagnosticStatus_${status}`);head.append(identity,badge);
    const metrics=document.createElement('dl');
    const fields=[
      [t('diagnosticLatency'),sample.samples?`${sample.average_latency_ms} ${t('millisecondsShort')}`:'—'],
      [t('diagnosticSuccess'),sample.samples?`${Math.round((Number(sample.success_rate)||0)*100)}%`:'—'],
      [t('diagnosticLastCheck'),diagnosticTime(sample.last_checked_at)]
    ];
    fields.forEach(([label,value])=>{const group=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const detail=document.createElement('dd');detail.textContent=value;group.append(term,detail);metrics.append(group)});
    const error=document.createElement('p');error.textContent=sample.last_error?`${t('diagnosticLastError')} · ${diagnosticTime(sample.last_error_at)}: ${String(sample.last_error).slice(0,240)}`:t(status==='disabled'?'diagnosticDisabledHint':'diagnosticNoErrors');
    row.append(head,metrics,error);ui.diagnosticsList.append(row);
  });
}
function diagnosticsReport(){
  const snapshot=state.diagnostics,data=snapshot?.data||{},health=data.source_health||{};
  return JSON.stringify({
    app:'AWUN',version:data.version||'unknown',created_at:new Date().toISOString(),platform:runtimePlatform,
    api:{mode:snapshot?.origin||'unavailable',latency_ms:snapshot?.endpoint_latency_ms??null,error:snapshot?.error||null},
    sources:diagnosticSources.map(source=>({source,enabled:(data.sources||[]).includes(source),status:health[source]?.status||'unknown',average_latency_ms:health[source]?.average_latency_ms??null,success_rate:health[source]?.success_rate??null,samples:health[source]?.samples??0,last_checked_at:health[source]?.last_checked_at||null,last_success_at:health[source]?.last_success_at||null,last_error_at:health[source]?.last_error_at||null,last_error:health[source]?.last_error||null}))
  },null,2);
}
async function copyDiagnostics(){
  const report=diagnosticsReport();
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(report);
    else{const area=document.createElement('textarea');area.value=report;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove()}
    ui.diagnosticsCopyStatus.textContent=t('diagnosticCopied');
  }catch{ui.diagnosticsCopyStatus.textContent=t('diagnosticCopyFailed')}
}

async function refreshStatus(){
  ui.diagnosticsRefresh?.setAttribute('aria-busy','true');
  try{
    const snapshot=await requestHealthSnapshot(),data=snapshot.data;state.diagnostics=snapshot;
    state.available=new Set(data.sources||[]);
    state.geniusEnabled=Boolean(data.providers?.track_stories?.genius_annotations);
    state.sources=new Set([...state.sources].filter(source=>state.available.has(source)));
    if(!state.sources.size)state.available.forEach(source=>state.sources.add(source));
    sourceButtons().forEach(button=>{
      const source=button.dataset.source;
      const available=state.available.has(source);
      button.disabled=!available;
      button.classList.toggle('on',available&&state.sources.has(source));
      button.querySelector('small').textContent=t(available?'active':'notConnected');
      button.title=t(available?'sourceAvailable':'sourceUnavailable',{source:sourceLabels[source]});
    });
    const names=[...state.available].map(source=>sourceLabels[source]||source);
    ui.status.className='status live';
    ui.status.querySelector('b').textContent=names.length?t('liveSources',{sources:names.join(' / ').toUpperCase()}):t('liveNoSources');
    ui.searchMeta.textContent=names.length?t(names.length===1?'sourceOnline':'sourcesOnline',{count:names.length}):t('localNoSources');
  }catch(error){
    state.diagnostics={error:error?.message||t('healthFailed'),origin:'unavailable',endpoint_latency_ms:null,checked_at:new Date().toISOString(),data:{sources:[],source_health:{},providers:{}}};
    ui.status.className='status offline';
    ui.status.querySelector('b').textContent=t('offline');
    ui.searchMeta.textContent=t('healthFailed');
    sourceButtons().forEach(button=>{button.disabled=true;button.classList.remove('on');button.querySelector('small').textContent=t('offline')});
  }finally{ui.diagnosticsRefresh?.removeAttribute('aria-busy');renderDiagnostics()}
}

function loadingRows(){
  ui.trackList.replaceChildren();
  for(let index=0;index<4;index+=1){
    const row=document.createElement('li');row.className='skeleton';
    for(let part=0;part<4;part+=1)row.append(document.createElement('i'));
    ui.trackList.append(row);
  }
}

const recommendationSets=[
  {title:'Nocturnal Electronica',subtitle:'Ambient · Electronic',query:'nocturnal electronica',className:'recommendation-night'},
  {title:'Cinematic Piano',subtitle:'Instrumental · Focus',query:'cinematic piano',className:'recommendation-piano'},
  {title:'Dark Ambient',subtitle:'Atmospheric · Slow',query:'dark ambient',className:'recommendation-ambient'},
  {title:'Lo-Fi Study',subtitle:'Beats · Focus',query:'lo-fi study',className:'recommendation-lofi'}
];

function rememberRecent(track){
  state.recents=[track,...state.recents.filter(item=>item.id!==track.id)].slice(0,12);
  persist();
}

function renderHome(){
  if(!ui.recentList||!ui.recommendationGrid)return;
  const recentSource=state.recents.length?state.recents:state.saved;
  ui.recentList.replaceChildren();
  recentSource.slice(0,4).forEach((track,index)=>{
    const card=document.createElement('li');card.className=`home-track-card ${state.active?.id===track.id?'active':''}`.trim();card.style.setProperty('--i',index);
    const cover=document.createElement('div');cover.className='home-track-cover';const image=safeImage(track.thumbnail);if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=decodeText(track.title||'AW').slice(0,2).toUpperCase();
    const activate=()=>state.active?.id===track.id?togglePlayback():playTrack(track);
    const play=document.createElement('button');play.type='button';play.className='home-track-play';play.textContent=state.active?.id===track.id?'Ⅱ':'▶';play.setAttribute('aria-label',t('playTrackAria',{title:decodeText(track.title)}));play.onclick=activate;
    cover.append(play);
    const meter=document.createElement('span');meter.className='home-track-meter';meter.setAttribute('aria-hidden','true');applyWaveform(meter,track,58);cover.append(meter);
    const body=document.createElement('div');body.className='home-track-body';const title=document.createElement('button');title.type='button';title.className='home-track-title';title.textContent=decodeText(track.title)||t('unknownTitle');title.onclick=activate;const artist=document.createElement('span');artist.className='home-track-artist';artist.textContent=decodeText(track.artist)||t('unknownArtist');body.append(title,artist);
    const footer=document.createElement('div');footer.className='home-track-footer';const duration=document.createElement('span');duration.className='home-track-duration';duration.textContent=formatTime(track.duration);const save=document.createElement('button');save.type='button';save.className=`home-track-save ${selectedIds().has(track.id)?'saved':''}`;save.textContent=selectedIds().has(track.id)?'♥':'♡';save.setAttribute('aria-label',t(selectedIds().has(track.id)?'saved':'addLibrary'));save.onclick=event=>{event.stopPropagation();toggleSave(track)};footer.append(duration,save);card.append(cover,body,footer);card.onclick=event=>{if(!event.target.closest('button'))activate()};ui.recentList.append(card);
  });
  if(!recentSource.length){const empty=document.createElement('li');empty.className='home-empty';empty.innerHTML=`<span>${t('nothingPlaying')}</span><button type="button">${t('search')}</button>`;empty.querySelector('button').onclick=()=>ui.searchInput.focus();ui.recentList.append(empty)}
  ui.recommendationGrid.replaceChildren();recommendationSets.forEach((set,index)=>{const card=document.createElement('button');card.type='button';card.className=`recommendation-card ${set.className}`;card.style.setProperty('--i',index);card.dataset.query=set.query;const title=document.createElement('strong');title.textContent=set.title;const subtitle=document.createElement('span');subtitle.textContent=set.subtitle;const action=document.createElement('b');action.textContent=`${t('search')} ↗`;card.append(title,subtitle,action);card.onclick=()=>{ui.searchInput.value=set.query;search(set.query)};ui.recommendationGrid.append(card)});
}

function seedContextQueue(track){
  if(state.queueMode==='manual'&&state.queue.length)return;
  const list=currentList();const index=list.findIndex(item=>item.id===track.id);
  state.queue=index>=0?playerCore.uniqueTracks(list.slice(index+1)):[];
  state.queueMode='context';persistQueue();
}

function replaceQueue(tracks,mode='context'){
  state.queue=playerCore.uniqueTracks(tracks).filter(track=>track.id!==state.active?.id);
  state.queueMode=mode==='manual'?'manual':'context';persistQueue();renderQueue();
}

function appendQueue(tracks,mode=state.queueMode){
  state.queue=playerCore.uniqueTracks([...state.queue,...tracks]).filter(track=>track.id!==state.active?.id);
  state.queueMode=mode==='manual'?'manual':'context';persistQueue();renderQueue();
}

function queueTrack(track,position){
  state.queue=playerCore.enqueue(state.queue,track,position);
  state.queueMode='manual';persistQueue();render();
  setMessage(t(position==='next'?'queuedNext':'queuedEnd',{track:decodeText(track.title)}),'notice');
}

function removeQueuedTrack(trackId){
  state.queue=playerCore.remove(state.queue,trackId);state.queueMode='manual';persistQueue();render();
}

function moveQueuedTrack(fromIndex,toIndex){
  const next=Math.max(0,Math.min(state.queue.length-1,toIndex));
  state.queue=playerCore.move(state.queue,fromIndex,next);state.queueMode='manual';persistQueue();render();
}

async function playQueuedTrack(track){
  removeQueuedTrack(track.id);setQueueOpen(false);await playTrack(track,{preserveQueue:true});
}

function renderQueue(){
  if(!ui.queueList||!ui.queueEmpty)return;
  ui.queueList.replaceChildren();ui.queueEmpty.hidden=Boolean(state.queue.length);
  state.queue.forEach((track,index)=>{
    const item=document.createElement('li');item.className='queue-item';item.draggable=true;item.dataset.queueId=track.id;
    const grip=document.createElement('span');grip.className='queue-grip';grip.textContent='⋮⋮';grip.setAttribute('aria-hidden','true');
    const image=safeImage(track.thumbnail);const cover=document.createElement('span');cover.className='queue-cover';if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=decodeText(track.title||'AW').slice(0,2).toUpperCase();
    const button=document.createElement('button');button.type='button';button.className='queue-track';const title=document.createElement('strong');title.textContent=decodeText(track.title)||t('unknownTitle');const artist=document.createElement('span');artist.textContent=decodeText(track.artist)||t('unknownArtist');button.append(title,artist);button.onclick=()=>playQueuedTrack(track);
    const duration=document.createElement('time');duration.textContent=formatTime(track.duration);
    const controls=document.createElement('div');controls.className='queue-controls';
    const up=document.createElement('button');up.type='button';up.textContent='↑';up.disabled=index===0;up.setAttribute('aria-label',t('queueMoveUpAria',{track:decodeText(track.title)}));up.onclick=()=>moveQueuedTrack(index,index-1);
    const down=document.createElement('button');down.type='button';down.textContent='↓';down.disabled=index===state.queue.length-1;down.setAttribute('aria-label',t('queueMoveDownAria',{track:decodeText(track.title)}));down.onclick=()=>moveQueuedTrack(index,index+1);
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',t('queueRemoveAria',{track:decodeText(track.title)}));remove.onclick=()=>removeQueuedTrack(track.id);controls.append(up,down,remove);
    item.addEventListener('dragstart',event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));item.classList.add('dragging')});
    item.addEventListener('dragend',()=>item.classList.remove('dragging'));
    item.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='move'});
    item.addEventListener('drop',event=>{event.preventDefault();const from=Number(event.dataTransfer.getData('text/plain'));if(Number.isInteger(from))moveQueuedTrack(from,index)});
    item.append(grip,cover,button,duration,controls);ui.queueList.append(item);
  });
}

function render(){
  const list=currentList(),saved=selectedIds();
  const showHome=!state.library&&!state.hasSearched;
  ui.homeSections.hidden=!showHome;
  ui.results.hidden=showHome;
  renderHome();
  renderQueue();
  ui.emptyGuide.hidden=Boolean(list.length);
  ui.trackList.replaceChildren();
  ui.resultTitle.textContent=t(state.library?'yourLibrary':state.flow?.active?'wave':state.tracks.length?'searchResults':'discover');
  ui.resultCount.textContent=t(state.library?'savedCount':'foundCount',{count:list.length});

  list.forEach((track,index)=>{
    const needsMatch=track.source==='yandex_music';
    const row=document.createElement('li');row.className=`track ${state.active?.id===track.id?'active':''} ${state.expanded===track.id?'expanded':''}`.trim();row.dataset.source=track.source;row.style.setProperty('--i',index);row.setAttribute('aria-expanded',String(state.expanded===track.id));
    const cover=document.createElement('div');cover.className='cover';const image=safeImage(track.thumbnail);if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=decodeText(track.title||'?').slice(0,2).toUpperCase();
    const activateTrack=()=>state.active?.id===track.id?togglePlayback():playTrack(track);
    const play=document.createElement('button');play.className='play';play.type='button';play.textContent=needsMatch?'↻':state.active?.id===track.id?'Ⅱ':'▶';play.setAttribute('aria-label',t(needsMatch?'matchAndPlayAria':'playTrackAria',{title:decodeText(track.title)}));play.onclick=event=>{event.stopPropagation();activateTrack()};
    const name=document.createElement('button');name.className='name';name.type='button';name.setAttribute('aria-label',t('playTrackAria',{title:decodeText(track.title)}));const title=document.createElement('strong');title.textContent=decodeText(track.title)||t('unknownTitle');const artist=document.createElement('span');artist.textContent=decodeText(track.artist)||t('unknownArtist');name.append(title,artist);name.onclick=event=>{event.stopPropagation();activateTrack()};
    const waveform=document.createElement('button');waveform.className='track-waveform';waveform.type='button';waveform.setAttribute('aria-label',t('playTrackAria',{title:decodeText(track.title)}));applyWaveform(waveform,track,74);waveform.onclick=event=>{event.stopPropagation();activateTrack()};
    const source=document.createElement('span');source.className=`tag ${track.source}`;source.textContent=sourceLabels[track.source]||track.source;
    const quality=document.createElement('span');quality.className='quality';quality.textContent=track.quality||'—';
    const duration=document.createElement('span');duration.className='duration';duration.textContent=formatTime(track.duration);
    const actions=document.createElement('div');actions.className='actions';
    const story=document.createElement('button');story.className='story-button';story.type='button';story.textContent=t(state.expanded===track.id?'close':'story');story.setAttribute('aria-expanded',String(state.expanded===track.id));story.onclick=event=>{event.stopPropagation();toggleStory(track)};actions.append(story);
    const save=document.createElement('button');save.className=`save ${saved.has(track.id)?'saved':''}`;save.type='button';save.textContent=t(saved.has(track.id)?'saved':'addLibrary');save.onclick=event=>{event.stopPropagation();toggleSave(track)};actions.append(save);
    const queueMenu=document.createElement('details');queueMenu.className='track-queue-menu';const queueSummary=document.createElement('summary');queueSummary.textContent='☷';queueSummary.setAttribute('aria-label',t('queueActionsAria',{track:decodeText(track.title)}));const queueOptions=document.createElement('div');const playNext=document.createElement('button');playNext.type='button';playNext.textContent=t('playNext');playNext.onclick=event=>{event.stopPropagation();queueTrack(track,'next');queueMenu.open=false};const addQueue=document.createElement('button');addQueue.type='button';addQueue.textContent=t('addToQueue');addQueue.onclick=event=>{event.stopPropagation();queueTrack(track,'end');queueMenu.open=false};queueOptions.append(playNext,addQueue);queueMenu.append(queueSummary,queueOptions);queueMenu.addEventListener('toggle',()=>{row.classList.toggle('queue-menu-open',queueMenu.open);if(!queueMenu.open){queueMenu.classList.remove('opens-up');return}document.querySelectorAll('.track-queue-menu[open]').forEach(menu=>{if(menu!==queueMenu)menu.open=false});requestAnimationFrame(()=>{const boundary=ui.results.getBoundingClientRect(),options=queueOptions.getBoundingClientRect();queueMenu.classList.toggle('opens-up',options.bottom>boundary.bottom-8)})});actions.append(queueMenu);
    if(track.download_url&&!playStoreMode){const download=document.createElement('a');download.className='download';download.href=track.download_url;download.download='';download.rel='noopener';download.textContent=t('download');download.onclick=event=>event.stopPropagation();actions.append(download)}
    const catalog=document.createElement('div');catalog.className='catalog-links';
    [['spotify','SPOTIFY'],['apple_music','APPLE'],['yandex_music','YANDEX']].forEach(([provider,label])=>{const href=track.catalog_links?.[provider];if(!href)return;const link=document.createElement('a');link.className='catalog-link';link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${label} ↗`;link.setAttribute('aria-label',t('findCatalogAria',{title:decodeText(track.title),source:label}));catalog.append(link)});
    if(catalog.childElementCount)actions.append(catalog);
    row.addEventListener('click',event=>{if(!event.target.closest('button,a,input,textarea,select,details,summary'))activateTrack()});
    row.append(cover,play,name,waveform,source,quality,duration,actions);
    if(state.expanded===track.id)row.append(renderStory(track));
    ui.trackList.append(row);
  });
}

function commentKey(track,line){return `${track.id}\u0000${line.index}\u0000${matchText(line.text).slice(0,80)}`}
function persistLineComments(){localStorage.setItem('awun-line-comments-v1',JSON.stringify(state.lineComments))}
function localComments(track,line){const value=state.lineComments[commentKey(track,line)];return Array.isArray(value)?value:[]}

function addLineComment(track,line,value){
  const text=String(value||'').trim().slice(0,500);if(!text)return;
  const key=commentKey(track,line),comments=localComments(track,line);
  state.lineComments[key]=[...comments,{id:`local_${Date.now()}`,text,created_at:new Date().toISOString()}].slice(-20);
  state.openLines.add(`${track.id}:${line.index}`);persistLineComments();render();
}

function removeLineComment(track,line,id){
  const key=commentKey(track,line);state.lineComments[key]=localComments(track,line).filter(comment=>comment.id!==id);persistLineComments();render();
}

function toggleLine(track,line){const key=`${track.id}:${line.index}`;state.openLines.has(key)?state.openLines.delete(key):state.openLines.add(key);render()}

function renderStory(track){
  const panel=document.createElement('section');panel.className='track-story';panel.setAttribute('aria-label',t('trackStoryAria',{title:decodeText(track.title)}));panel.onclick=event=>event.stopPropagation();
  const heading=document.createElement('header');heading.className='story-head';const label=document.createElement('div');const kicker=document.createElement('span');kicker.textContent=t('trackStory');const title=document.createElement('h2');title.textContent=decodeText(track.title);const artist=document.createElement('p');artist.textContent=decodeText(track.artist);label.append(kicker,title,artist);const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',t('closeTrackStoryAria'));close.onclick=()=>toggleStory(track);heading.append(label,close);panel.append(heading);
  const details=state.details.get(track.id);
  if(!details||details.loading){const loading=document.createElement('div');loading.className='story-loading';loading.textContent=t('findingLyrics');panel.append(loading);return panel}
  if(details.error){const error=document.createElement('p');error.className='story-empty';error.textContent=details.error;panel.append(error);return panel}
  const meta=document.createElement('div');meta.className='story-meta';const source=document.createElement('span');source.textContent=t(details.lyrics_source?'lyricsAvailable':'lyricsUnavailable');const sync=document.createElement('span');sync.textContent=t(details.lines?.length?(details.synced?'timeSynced':'plainText'):'noText');const annotations=document.createElement('span');const geniusLabels={matched:`${t('geniusMatched')}${details.annotation_count?` · ${details.annotation_count}`:''}`,not_found:t('geniusNoMatch'),error:t('geniusError'),disabled:t('geniusOptional')};annotations.textContent=geniusLabels[details.genius_status]||t('geniusChecking');annotations.dataset.status=details.genius_status||'unknown';meta.append(source,sync,annotations);panel.append(meta);
  if(details.match_type==='canonical'&&details.matched_title){const match=document.createElement('p');match.className='story-match';match.textContent=t('canonicalMatch',{track:[details.matched_artist,details.matched_title].filter(Boolean).map(decodeText).join(' — ')});panel.append(match)}
  if(details.message){const note=document.createElement('p');note.className='story-note';note.textContent=details.message;panel.append(note)}
  if(!details.lines?.length){const empty=document.createElement('p');empty.className='story-empty';empty.textContent=t('noLyricsReturned');panel.append(empty)}
  const lyrics=document.createElement('div');lyrics.className='lyrics';
  (details.lines||[]).forEach(line=>{
    const lineKey=`${track.id}:${line.index}`,comments=localComments(track,line),open=state.openLines.has(lineKey);const row=document.createElement('article');row.className=`lyric-line ${open?'open':''}`;
    const time=document.createElement('button');time.type='button';time.className='lyric-time';time.textContent=line.time==null?'·':formatTime(line.time);time.disabled=line.time==null;time.title=t(line.time==null?'noTimestamp':'playFromLine');time.onclick=()=>{if(state.active?.id!==track.id)playTrack(track).then(()=>setTimeout(()=>seekTo(line.time||0,true),650));else seekTo(line.time||0,true)};
    const text=document.createElement('button');text.type='button';text.className='lyric-text';text.textContent=decodeText(line.text);text.setAttribute('aria-expanded',String(open));text.onclick=()=>toggleLine(track,line);
    const count=document.createElement('button');count.type='button';count.className='annotation-count';count.textContent=`${(line.annotations?.length||0)+comments.length}`;count.setAttribute('aria-label',t('commentCount',{count:(line.annotations?.length||0)+comments.length}));count.onclick=()=>toggleLine(track,line);row.append(time,text,count);
    if(open){const thread=document.createElement('div');thread.className='line-thread';
      (line.annotations||[]).forEach(annotation=>{const item=document.createElement('blockquote');const body=document.createElement('p');body.textContent=decodeText(annotation.text);const footer=document.createElement('footer');const by=document.createElement('span');by.textContent=`GENIUS${annotation.author?` · ${decodeText(annotation.author)}`:''}${annotation.votes?` · ${t('votes',{count:annotation.votes})}`:''}`;footer.append(by);if(annotation.url){const link=document.createElement('a');link.href=annotation.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=t('open');footer.append(link)}item.append(body,footer);thread.append(item)});
      comments.forEach(comment=>{const item=document.createElement('blockquote');item.className='local-comment';const body=document.createElement('p');body.textContent=comment.text;const footer=document.createElement('footer');const by=document.createElement('span');by.textContent=t('yourNote');const remove=document.createElement('button');remove.type='button';remove.textContent=t('delete');remove.onclick=()=>removeLineComment(track,line,comment.id);footer.append(by,remove);item.append(body,footer);thread.append(item)});
      const form=document.createElement('form');form.className='line-comment-form';const input=document.createElement('input');input.maxLength=500;input.placeholder=t('addNotePlaceholder');input.setAttribute('aria-label',t('addNoteAria'));const submit=document.createElement('button');submit.type='submit';submit.textContent=t('add');form.append(input,submit);form.onsubmit=event=>{event.preventDefault();addLineComment(track,line,input.value)};thread.append(form);row.append(thread)}
    lyrics.append(row)
  });panel.append(lyrics);
  const footer=document.createElement('footer');footer.className='story-footer';const attribution=document.createElement('span');attribution.textContent=t('lyricsNotice');footer.append(attribution);if(details.genius_url){const link=document.createElement('a');link.href=details.genius_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=t('viewGenius');footer.append(link)}panel.append(footer);return panel;
}

async function loadStory(track){
  state.detailsController?.abort();state.detailsController=new AbortController();state.details.set(track.id,{loading:true});render();
  try{const params=new URLSearchParams({artist:decodeText(track.artist),title:decodeText(track.title),duration:String(track.duration||0)});const response=await awunFetch(`/api/v1/track-details?${params}`,{signal:state.detailsController.signal});const data=await response.json();if(!response.ok)throw new Error(data.detail||t('storyUnavailable'));state.details.set(track.id,data);render()}catch(error){if(error.name==='AbortError')return;state.details.set(track.id,{error:error.message||t('storyUnavailable')});render()}
}

function toggleStory(track){
  const opening=state.expanded!==track.id;state.expanded=opening?track.id:null;render();if(opening&&!state.details.has(track.id))loadStory(track);
}

function toggleSave(track){
  const index=state.saved.findIndex(item=>item.id===track.id);
  if(index>=0)state.saved.splice(index,1);else state.saved.unshift({...track,title:decodeText(track.title),artist:decodeText(track.artist)});
  persist();render();emitAwun('library',{track,saved:index<0});
}

function progressiveTracks(tracksBySource,sourceOrder,limit){
  return playerCore.interleaveTracks(tracksBySource,sourceOrder,limit);
}
function mergeProgressiveData(aggregate,data,source,sourceOrder,limit){
  aggregate.tracks_by_source[source]=playerCore.uniqueTracks([...(aggregate.tracks_by_source[source]||[]),...(data.tracks||[])]);
  aggregate.tracks=progressiveTracks(aggregate.tracks_by_source,sourceOrder,limit);
  aggregate.searched_sources=[...new Set([...aggregate.searched_sources,...(data.searched_sources||[]),source])];
  aggregate.query_variants=[...new Set([...aggregate.query_variants,...(data.query_variants||[])])];
  aggregate.elapsed_ms=Math.max(aggregate.elapsed_ms,Number(data.elapsed_ms)||0);
  if(data.errors?.[source])aggregate.errors[source]=data.errors[source];else delete aggregate.errors[source];
  return aggregate;
}

async function search(query=ui.searchInput.value.trim()){
  if(!query)return;
  if(!state.sources.size){setMessage(t('noSourcesError'),'error');return}
  state.controller?.abort();state.controller=new AbortController();state.library=false;state.hasSearched=true;ui.libraryButton.classList.remove('active');ui.libraryButton.setAttribute('aria-pressed','false');
  ui.results.setAttribute('aria-busy','true');ui.emptyGuide.hidden=true;ui.searchButton.classList.add('searching');document.body.classList.add('is-searching');setMessage(t('searchingSources'),'loading');loadingRows();ui.resultTitle.textContent=t('searching');ui.resultCount.textContent='—';ui.resultTime.textContent=t('pleaseWait');
  const started=performance.now(),controller=state.controller,sources=[...state.sources],perSourceLimit=Math.min(state.resultLimit,Math.max(8,Math.ceil((state.resultLimit/sources.length)*1.6)));
  const aggregate={query,tracks:[],tracks_by_source:{},total:0,searched_sources:[],region:state.region,query_variants:[],errors:{},elapsed_ms:0};
  let completed=0;
  const applyResults=(final=false)=>{
    if(state.controller!==controller||controller.signal.aborted)return;
    aggregate.total=aggregate.tracks.length;state.tracks=aggregate.tracks;
    const failures=Object.keys(aggregate.errors).map(source=>sourceLabels[source]||source),pending=Math.max(0,sources.length-completed);
    if(!final&&pending){setMessage(t('progressiveResults',{count:state.tracks.length,pending}),'loading');ui.resultTime.textContent=t('progressiveSources',{done:completed,total:sources.length});}
    else if(state.tracks.length)setMessage(failures.length?t('partialResults',{sources:failures.join(', ')}):t('selectTrack'),failures.length?'notice':'');
    else setMessage(failures.length?t('noPlayableResults',{sources:failures.join(', ')}):t('nothingFound'),'error');
    if(final){const variants=Math.max(1,aggregate.query_variants.length||1);ui.resultTime.textContent=t('searchTiming',{ms:Math.round(performance.now()-started),variants})}
    if(state.tracks.length||final)render();
  };
  try{
    const payload={query,limit:perSourceLimit,region:state.region,locale:navigator.language||null};
    await Promise.all(sources.map(async source=>{
      try{
        const {data,supplement}=await requestSearch({...payload,sources:[source]},{signal:controller.signal});
        if(controller.signal.aborted)return;
        mergeProgressiveData(aggregate,data,source,sources,state.resultLimit);applyResults(false);
        if(supplement){const merged=await supplement;if(merged&&!controller.signal.aborted){mergeProgressiveData(aggregate,merged,source,sources,state.resultLimit);applyResults(false)}}
      }catch(error){if(error?.name!=='AbortError')aggregate.errors[source]=error?.message||t('searchFailed')}
      finally{completed+=1;if(!controller.signal.aborted)applyResults(false)}
    }));
    if(controller.signal.aborted)return;
    applyResults(true);
    const params=new URLSearchParams(runtimeParams);params.set('q',query);if(state.region!=='AUTO')params.set('region',state.region);else params.delete('region');if(state.resultLimit!==60)params.set('limit',String(state.resultLimit));else params.delete('limit');history.replaceState(null,'',`${location.pathname}?${params}`);
  }catch(error){
    if(error.name==='AbortError')return;
    state.tracks=[];render();setMessage(error.message||t('searchUnavailable'),'error');ui.resultTime.textContent=t('failed');
  }finally{if(state.controller===controller){ui.results.setAttribute('aria-busy','false');ui.searchButton.classList.remove('searching');document.body.classList.remove('is-searching')}}
}

function youtubeId(track){
  if(track.id?.startsWith('yt_'))return track.id.slice(3);
  try{return new URL(track.stream_url).searchParams.get('v')||''}catch{return''}
}

function ensureYouTubeApi(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(state.youtubeApi)return state.youtubeApi;
  state.youtubeApi=new Promise((resolve,reject)=>{
    const previous=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{if(typeof previous==='function')previous();resolve(window.YT)};
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.onerror=()=>reject(new Error(t('youtubePlayerLoadFailed')));document.head.append(script);
    setTimeout(()=>{if(!window.YT?.Player)reject(new Error(t('youtubePlayerTimeout')))},15000);
  });
  return state.youtubeApi;
}

function stopYouTube(){
  clearInterval(state.youtubeTicker);state.youtubeTicker=null;
  if(state.youtube){try{state.youtube.destroy()}catch{}state.youtube=null}
  ui.youtubePlayer.replaceChildren();ui.youtubeDock.hidden=true;
}

function stopHls(){
  if(state.hls){try{state.hls.destroy()}catch{}state.hls=null}
}

function setPlaying(playing){ui.playPause.querySelector('span').textContent=playing?'Ⅱ':'▶';ui.playPause.setAttribute('aria-label',t(playing?'pauseAria':'playAria'));document.body.classList.toggle('is-playing',playing);ui.player.classList.toggle('is-playing',playing)}

function applyRepeatMode(save=true){
  const labels={off:'repeatOff',all:'repeatAll',one:'repeatOne'},descriptions={off:'repeatOffAria',all:'repeatAllAria',one:'repeatOneAria'};
  ui.repeatMode.querySelector('small').textContent=t(labels[state.repeatMode]);ui.repeatMode.setAttribute('aria-label',t(descriptions[state.repeatMode]));ui.repeatMode.setAttribute('aria-pressed',String(state.repeatMode!=='off'));ui.repeatMode.classList.toggle('active',state.repeatMode!=='off');ui.repeatMode.dataset.mode=state.repeatMode;
  if(save)localStorage.setItem('awun-repeat-mode',state.repeatMode);
}

function cycleRepeatMode(){const modes=['off','all','one'];state.repeatMode=modes[(modes.indexOf(state.repeatMode)+1)%modes.length];applyRepeatMode()}

function updateTimeline(current,duration){
  const percent=duration?Math.max(0,Math.min(100,(current/duration)*100)):0;
  state.playbackPosition=Math.max(0,Number(current)||0);
  if(!state.seeking)setRange(ui.progress,Math.round(percent*10));
  document.querySelector('.track.active .track-waveform')?.style.setProperty('--track-progress',`${percent}%`);
  document.querySelector('.home-track-card.active .home-track-meter')?.style.setProperty('--track-progress',`${percent}%`);
  ui.elapsed.textContent=formatTime(current);ui.totalTime.textContent=formatTime(duration);
}

async function playYouTube(track,startAt=0){
  state.audioTrackId=null;ui.audio.pause();ui.audio.removeAttribute('src');stopHls();stopYouTube();ui.youtubeDock.hidden=false;ui.youtubeDock.classList.remove('minimized');
  const YT=await ensureYouTubeApi(),videoId=youtubeId(track);if(!videoId)throw new Error(t('invalidYoutubeResult'));
  const target=document.createElement('div');ui.youtubePlayer.replaceChildren(target);
  await new Promise((resolve,reject)=>{
    let ready=false;
    state.youtube=new YT.Player(target,{width:'100%',height:'100%',videoId,playerVars:{autoplay:1,controls:1,playsinline:1,rel:0,origin:location.origin},events:{
      onReady:event=>{ready=true;event.target.setVolume(Number(ui.volume.value));if(startAt>0)event.target.seekTo(startAt,true);event.target.playVideo();setPlaying(true);state.youtubeTicker=setInterval(()=>{if(state.youtube?.getCurrentTime)updateTimeline(state.youtube.getCurrentTime(),state.youtube.getDuration())},500);resolve()},
      onStateChange:event=>{if(event.data===YT.PlayerState.PLAYING)setPlaying(true);if(event.data===YT.PlayerState.PAUSED)setPlaying(false);if(event.data===YT.PlayerState.ENDED)handleTrackEnded()},
      onError:()=>{const error=new Error(t('youtubeEmbedError'));if(ready)recoverPlayback(error);else reject(error)}
    }});
  });
}

function applyAudioStart(startAt){
  if(!(startAt>0))return;
  const seek=()=>{try{ui.audio.currentTime=startAt}catch{}};
  if(ui.audio.readyState>=1)seek();else ui.audio.addEventListener('loadedmetadata',seek,{once:true});
}

async function playAudio(track,startAt=0){
  stopYouTube();stopHls();state.audioTrackId=null;ui.audio.pause();ui.audio.removeAttribute('src');ui.audio.load();ui.audio.volume=Number(ui.volume.value)/100;state.audioTrackId=track.id;
  if(track.source==='soundcloud'&&window.Hls?.isSupported?.()){
    const hls=new window.Hls({enableWorker:true});state.hls=hls;
    await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(callback,value)=>{if(settled)return;settled=true;callback(value)};
      hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(!data.fatal)return;if(settled)recoverPlayback(new Error(t('playbackFailed')));else finish(reject,new Error(t('playbackFailed')))});
      hls.on(window.Hls.Events.MANIFEST_PARSED,async()=>{
        try{applyAudioStart(startAt);await ui.audio.play();setPlaying(true);finish(resolve)}catch(error){finish(reject,error)}
      });
      hls.on(window.Hls.Events.MEDIA_ATTACHED,()=>hls.loadSource(track.stream_url));
      hls.attachMedia(ui.audio);
    });
    return;
  }
  ui.audio.src=track.stream_url;
  applyAudioStart(startAt);await ui.audio.play();setPlaying(true);
}

function updateMediaSession(track){
  if(!('mediaSession'in navigator)||!('MediaMetadata'in window))return;
  const artwork=safeImage(track.thumbnail);navigator.mediaSession.metadata=new MediaMetadata({title:decodeText(track.title),artist:decodeText(track.artist),album:`AWUN · ${sourceLabels[track.source]||track.source}`,artwork:artwork?[{src:artwork}]:[]});
  const actions={play:()=>resumePlayback(),pause:()=>pausePlayback(),previoustrack:()=>previousTrack(),nexttrack:()=>nextTrack(),seekbackward:details=>seekRelative(-(details.seekOffset||10)),seekforward:details=>seekRelative(details.seekOffset||10)};
  Object.entries(actions).forEach(([action,handler])=>{try{navigator.mediaSession.setActionHandler(action,handler)}catch{}});
}

function matchText(value){return decodeText(value).toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function matchScore(candidate,imported){
  const title=matchText(candidate.title),artist=matchText(candidate.artist),wantedTitle=matchText(imported.title),wantedArtist=matchText(imported.artist==='Yandex Music'?'':imported.artist);
  let score=Number(candidate.score)||0;if(title===wantedTitle)score+=80;else if(title.includes(wantedTitle)||wantedTitle.includes(title))score+=35;if(wantedArtist&&(artist===wantedArtist||artist.includes(wantedArtist)||wantedArtist.includes(artist)))score+=55;return score;
}
async function matchImportedTrack(track){
  setMessage(t('matchingTrack',{track:`${decodeText(track.artist)} — ${decodeText(track.title)}`}),'loading');
  try{
    const sources=[...state.sources].filter(source=>state.available.has(source));
    const {data}=await requestSearch({query:`${track.artist==='Yandex Music'?'':track.artist} ${track.title}`.trim(),limit:12,sources:sources.length?sources:[...state.available],region:state.region,locale:navigator.language||null},{waitForFallback:true});
    const candidates=data.tracks||[];if(!candidates.length)throw new Error(t('noPlayableMatch'));
    const fresh=[...candidates].sort((left,right)=>matchScore(right,track)-matchScore(left,track))[0];fresh.catalog_links={...fresh.catalog_links,...track.catalog_links};fresh.import_origin='yandex_music';
    const savedIndex=state.saved.findIndex(item=>item.id===track.id);if(savedIndex>=0)state.saved[savedIndex]=fresh;persist();render();setMessage(t('matchedOn',{source:sourceLabels[fresh.source]||fresh.source}),'notice');await playTrack(fresh);
  }catch(error){setMessage(error.message||t('importedMatchFailed'),'error')}
}

function directImportedTrack(entry){
  if(entry.source!=='youtube'||!entry.external_id)return null;
  return{id:`yt_${entry.external_id}`,title:entry.title,artist:entry.artist||'YouTube',duration:0,quality:'VIDEO',source:'youtube',stream_url:entry.external_url||`https://www.youtube.com/watch?v=${entry.external_id}`,download_url:null,thumbnail:entry.thumbnail||null,score:82,catalog_links:{youtube:entry.external_url||`https://www.youtube.com/watch?v=${entry.external_id}`}};
}
async function findImportedMatch(track){
  if(track.source==='youtube'&&track.external_id)return directImportedTrack(track);
  const sources=[...state.sources].filter(source=>state.available.has(source));
  const {data}=await requestSearch({query:`${track.artist==='Yandex Music'?'':track.artist} ${track.title}`.trim(),limit:8,sources:sources.length?sources:[...state.available],region:state.region,locale:navigator.language||null},{waitForFallback:true});
  return [...(data.tracks||[])].sort((left,right)=>matchScore(right,track)-matchScore(left,track))[0]||null;
}
async function matchAndSaveImported(tracks){
  if(!tracks.length)throw new Error(t('noTracksInLibrary'));
  const queue=tracks.slice(0,100),matched=[],missed=[];let cursor=0,done=0;
  ui.importSubmit.disabled=true;ui.importUrlSubmit.disabled=true;ui.importProgress.hidden=false;ui.importProgress.max=queue.length;ui.importProgress.value=0;
  const worker=async()=>{while(cursor<queue.length){const track=queue[cursor++];try{const result=await findImportedMatch(track);if(result){result.import_origin='library_link';matched.push(result)}else missed.push(track)}catch{missed.push(track)}finally{done+=1;ui.importProgress.value=done;ui.importStatus.textContent=t('matchingProgress',{done,total:queue.length,found:matched.length});}}};
  try{await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));const existing=new Set(state.saved.map(track=>track.id));const additions=matched.filter(track=>!existing.has(track.id));state.saved=[...additions,...state.saved].slice(0,1500);persist();state.library=true;ui.libraryButton.classList.add('active');ui.libraryButton.setAttribute('aria-pressed','true');render();ui.importStatus.textContent=t('importDone',{added:additions.length,missed:missed.length,limit:tracks.length>100?t('first100'):''});setMessage(t('importSummary',{added:additions.length,missed:missed.length}),'notice');}
  finally{ui.importSubmit.disabled=false;ui.importUrlSubmit.disabled=false;}
}
async function importLibraryUrl(){
  const url=ui.importUrl.value.trim();if(!url){ui.importStatus.textContent=t('pastePlaylistFirst');return}
  ui.importUrlSubmit.disabled=true;ui.importStatus.textContent=t('readingPlaylist');
  try{const response=await awunFetch('/api/v1/library/import-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,max_tracks:100})});const data=await response.json();if(!response.ok)throw new Error(data.detail||t('playlistReadFailed'));ui.importStatus.textContent=t('tracksRead',{count:data.tracks.length});await matchAndSaveImported(data.tracks||[])}
  catch(error){ui.importStatus.textContent=error.message||t('playlistImportFailed')}
  finally{ui.importUrlSubmit.disabled=false}
}

async function playTrack(track,options={}){
  if(track.source==='yandex_music'){await matchImportedTrack(track);return false}
  const preserveQueue=Boolean(options.preserveQueue),recovered=Boolean(options.recovered),resumeAt=Math.max(0,Number(options.resumeAt)||0);
  const playbackGeneration=recovered?(Number(options.playbackGeneration)||state.playbackGeneration):(state.playbackGeneration+=1);
  let refreshAttempted=false,refreshSucceeded=false;
  const sessionFresh=!recovered?freshTracksByKey.get(trackSessionKey(track)):null;
  if(sessionFresh&&sessionFresh.stream_url!==track.stream_url)track=replaceStoredTrack(track,sessionFresh);
  if(!recovered&&options.refreshStored!==false&&shouldRefreshBeforePlayback(track)){
    refreshAttempted=true;state.sameSourceRefreshGeneration=playbackGeneration;setMessage(t('refreshingLink'),'loading');
    try{
      const refreshed=await refreshTrackLink(track);
      if(playbackGeneration!==state.playbackGeneration)return false;
      if(refreshed){track=replaceStoredTrack(track,refreshed);refreshSucceeded=true;setMessage(t('linkRefreshed'),'notice')}
    }catch(error){if(error?.name==='AbortError')return false}
  }
  if(!preserveQueue)seedContextQueue(track);
  state.queue=playerCore.remove(state.queue,track.id);persistQueue();
  const firstReveal=!state.active,previous=state.active;state.active=track;
  if(!recovered){state.playbackOrigin=track;state.failedSources.clear();state.sameSourceRefreshGeneration=refreshAttempted?playbackGeneration:null}
  else state.playbackOrigin=options.origin||state.playbackOrigin||track;
  rememberRecent(track);ui.player.classList.remove('player-empty');ui.idleStage.setAttribute('aria-hidden','true');document.body.classList.add('has-player');ui.player.classList.remove('track-enter','track-swap');void ui.player.offsetWidth;ui.player.classList.add(firstReveal?'track-enter':'track-swap');ui.nowTitle.textContent=decodeText(track.title);ui.nowArtist.textContent=`${decodeText(track.artist)} · ${sourceLabels[track.source]||track.source}`;ui.nowSource.textContent=sourceLabels[track.source]||track.source;
  const image=safeImage(track.thumbnail),monogram=ui.playerArtwork.querySelector('.vinyl-monogram');
  ui.playerArtwork.style.setProperty('--vinyl-cover',image?`url("${image}")`:'none');
  ui.playerArtwork.classList.toggle('has-artwork',Boolean(image));
  applyWaveform(ui.waveProgress,track,132);
  if(monogram)monogram.textContent=image?'':(decodeText(track.title)||'AW').slice(0,2).toUpperCase();
  updateTimeline(resumeAt,track.duration||0);updateMediaSession(track);render();emitAwun('play',{track,previous,recovered});
  try{
    if(track.source==='youtube')await playYouTube(track,resumeAt);else await playAudio(track,resumeAt);
    if(refreshAttempted&&!refreshSucceeded)setMessage('');
    return true;
  }catch(error){
    stopHls();setPlaying(false);
    if(error?.name==='NotAllowedError')return false;
    if(options.recoverOnFailure===false)return false;
    queueMicrotask(()=>recoverPlayback(error,playbackGeneration));return false;
  }
}

function pausePlayback(){if(state.active?.source==='youtube'){try{state.youtube?.pauseVideo()}catch{}}else ui.audio.pause();setPlaying(false)}
function resumePlayback(){if(state.active?.source==='youtube'){try{state.youtube?.playVideo()}catch{}}else ui.audio.play().catch(()=>{});setPlaying(true)}
function togglePlayback(){if(!state.active)return;const playing=state.active.source==='youtube'?state.youtube?.getPlayerState?.()===1:!ui.audio.paused;playing?pausePlayback():resumePlayback()}

function adjacentTrack(direction){const list=currentList();if(!list.length)return null;const index=Math.max(0,list.findIndex(track=>track.id===state.active?.id));return list[(index+direction+list.length)%list.length]}
function previousTrack(){const track=adjacentTrack(-1);if(!track)return;if(state.active)state.queue=playerCore.enqueue(state.queue,state.active,'next');state.queueMode='manual';persistQueue();playTrack(track,{preserveQueue:true})}
function nextTrack(automatic=false){
  if(!state.queue.length&&state.repeatMode==='all'){
    state.queue=playerCore.uniqueTracks(currentList().filter(track=>track.id!==state.active?.id));state.queueMode='context';persistQueue();
  }
  const track=state.queue[0];if(!track)return false;
  state.queue=state.queue.slice(1);persistQueue();render();if(!automatic)emitAwun('skip',{track:state.active,next:track});playTrack(track,{preserveQueue:true});return true;
}
function handleTrackEnded(){
  if(!state.active)return;
  if(state.repeatMode==='one'){seekTo(0,true);resumePlayback();return}
  emitAwun('complete',{track:state.active});
  if(nextTrack(true))return;
  setPlaying(false);const duration=state.active.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;updateTimeline(duration||state.active.duration||0,duration||state.active.duration||0);
}
function seekRelative(offset){const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;const current=state.active?.source==='youtube'?state.youtube?.getCurrentTime?.():ui.audio.currentTime;seekTo(Math.max(0,Math.min(duration||0,(current||0)+offset)),true)}
function seekTo(seconds,allowSeek=true){if(state.active?.source==='youtube'){try{state.youtube?.seekTo(seconds,allowSeek)}catch{}}else if(Number.isFinite(ui.audio.duration))ui.audio.currentTime=seconds}

function currentPlaybackTime(){
  const current=state.active?.source==='youtube'?state.youtube?.getCurrentTime?.():ui.audio.currentTime;
  return Math.max(0,Number(current)||0,state.playbackPosition||0);
}

function shouldRefreshBeforePlayback(track){
  return Boolean(track?.id&&track.source!=='youtube'&&track.source!=='yandex_music'&&!freshTracksByKey.has(trackSessionKey(track)));
}

async function refreshTrackLink(track){
  if(!track?.id||!track.source||track.source==='yandex_music')return null;
  const query=`${decodeText(track.artist)} ${decodeText(track.title)}`.trim();
  if(!query)return null;
  const {data}=await requestSearch({query,limit:12,sources:[track.source],region:state.region,locale:navigator.language||null,fast:true},{waitForFallback:true});
  const candidates=(data.tracks||[]).filter(candidate=>candidate.source===track.source);
  return candidates.find(candidate=>candidate.id===track.id)||playerCore.rankAlternatives(track,candidates,new Set())[0]||null;
}

function replaceStoredTrack(origin,replacement){
  const merged={...replacement,catalog_links:{...(origin.catalog_links||{}),...(replacement.catalog_links||{})}};
  const replace=items=>{const seen=new Set();return items.map(track=>track.id===origin.id?merged:track).filter(track=>{if(!track?.id||seen.has(track.id))return false;seen.add(track.id);return true})};
  state.saved=replace(state.saved);state.recents=replace(state.recents);state.queue=replace(state.queue);state.tracks=replace(state.tracks);
  freshTracksByKey.set(trackSessionKey(merged),merged);
  persist();
  return merged;
}

async function recoverPlayback(_error,expectedGeneration=state.playbackGeneration){
  if(!state.active||expectedGeneration!==state.playbackGeneration||state.recoveringGeneration===expectedGeneration)return false;
  const failed=state.active,origin=state.playbackOrigin||failed,resumeAt=currentPlaybackTime(),from=sourceLabels[failed.source]||failed.source;
  state.recoveringGeneration=expectedGeneration;
  try{
    if(state.sameSourceRefreshGeneration!==expectedGeneration){
      state.sameSourceRefreshGeneration=expectedGeneration;setMessage(t('refreshingLink'),'loading');
      let refreshed=null;
      try{refreshed=await refreshTrackLink(failed)}catch{}
      if(expectedGeneration!==state.playbackGeneration)return false;
      if(refreshed){
        const started=await playTrack(refreshed,{preserveQueue:true,recovered:true,resumeAt,origin,playbackGeneration:expectedGeneration,recoverOnFailure:false});
        if(expectedGeneration!==state.playbackGeneration)return false;
        if(started){replaceStoredTrack(origin,refreshed);setMessage(t('linkRefreshed'),'notice');return true}
      }
    }
    state.failedSources.add(failed.source);setMessage(t('findingAlternative',{source:from}),'loading');
    const sources=[...state.available].filter(source=>!state.failedSources.has(source)&&source!=='yandex_music');if(!sources.length)throw new Error();
    const {data}=await requestSearch({query:`${origin.artist} ${origin.title}`,limit:20,sources,region:state.region,locale:navigator.language||null},{waitForFallback:true});
    if(expectedGeneration!==state.playbackGeneration)return false;
    const alternatives=playerCore.rankAlternatives(origin,data.tracks||[],state.failedSources);
    for(const candidate of alternatives){
      if(expectedGeneration!==state.playbackGeneration)return false;
      const started=await playTrack(candidate,{preserveQueue:true,recovered:true,resumeAt,origin,playbackGeneration:expectedGeneration,recoverOnFailure:false});
      if(expectedGeneration!==state.playbackGeneration)return false;
      if(started){replaceStoredTrack(origin,candidate);setMessage(t('sourceSwitched',{from,to:sourceLabels[candidate.source]||candidate.source}),'notice');return true}
      state.failedSources.add(candidate.source);
    }
    throw new Error();
  }catch{setPlaying(false);setMessage(t('allSourcesFailed'),'error');return false}
  finally{if(state.recoveringGeneration===expectedGeneration)state.recoveringGeneration=null}
}

sourceButtons().forEach(button=>button.addEventListener('click',()=>{const source=button.dataset.source;if(!state.available.has(source))return;if(state.sources.has(source))state.sources.delete(source);else state.sources.add(source);button.classList.toggle('on',state.sources.has(source))}));
ui.allSourcesButton?.addEventListener('click',()=>{state.sources=new Set(state.available);sourceButtons().forEach(button=>button.classList.toggle('on',state.sources.has(button.dataset.source)))});
ui.regionSelect.addEventListener('change',()=>{state.region=regions.includes(ui.regionSelect.value)?ui.regionSelect.value:'AUTO';localStorage.setItem('awun-region',state.region)});
ui.limitSelect.addEventListener('change',()=>{const value=Number(ui.limitSelect.value);state.resultLimit=resultLimits.includes(value)?value:60;localStorage.setItem('awun-result-limit',String(state.resultLimit))});
ui.themeButton.addEventListener('click',()=>ui.themePanel.hidden?openThemePanel():closeThemePanel());ui.themeClose.addEventListener('click',closeThemePanel);ui.themeBackdrop.addEventListener('click',closeThemePanel);ui.diagnosticsButton.addEventListener('click',openDiagnosticsPanel);ui.diagnosticsClose.addEventListener('click',closeThemePanel);ui.diagnosticsRefresh.addEventListener('click',refreshStatus);ui.diagnosticsCopy.addEventListener('click',copyDiagnostics);document.getElementById('flowButton')?.addEventListener('click',()=>{setQueueOpen(false);setPlayerExpanded(false);if(!ui.themePanel.hidden||!ui.diagnosticsPanel.hidden)closeThemePanel()});
ui.importButton.addEventListener('click',()=>ui.importPanel.hidden?openImportPanel():closeImportPanel());ui.importClose.addEventListener('click',closeImportPanel);ui.importBackdrop.addEventListener('click',closeImportPanel);ui.importFileButton.addEventListener('click',()=>ui.libraryFile.click());ui.importSubmit.addEventListener('click',importLibrary);ui.importUrlSubmit.addEventListener('click',importLibraryUrl);
ui.libraryFile.addEventListener('change',async()=>{const file=ui.libraryFile.files?.[0];if(!file)return;if(file.size>2*1024*1024){ui.importStatus.textContent=t('fileTooLarge');return}try{ui.importText.value=await file.text();ui.importFileName.textContent=file.name;const count=parseImportedLibrary(ui.importText.value,file.name).length;ui.importStatus.textContent=t('uniqueTracksReady',{count})}catch(error){ui.importStatus.textContent=error.message||t('fileReadFailed')}});
document.querySelectorAll('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>{state.theme=button.dataset.themeChoice;applyVisual()}));
document.querySelectorAll('[data-home-action]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.homeAction==='all-recent'&&state.recents.length){state.library=false;state.hasSearched=true;state.tracks=[...state.recents];render();return}ui.searchInput.focus({preventScroll:true});ui.searchInput.scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'})}));
ui.motionToggle.addEventListener('click',()=>{state.motion=state.motion==='on'?'off':'on';applyVisual()});ui.decorToggle.addEventListener('click',()=>{state.decor=state.decor==='full'?'minimal':'full';applyVisual()});ui.densityToggle.addEventListener('click',()=>{const modes=['compact','standard','airy'];state.density=modes[(modes.indexOf(state.density)+1)%modes.length];applyVisual()});
ui.searchForm.addEventListener('submit',event=>{event.preventDefault();search()});
ui.languageButton.addEventListener('click',()=>i18n.setLanguage(language==='en'?'ru':'en'));document.querySelectorAll('[data-search-suggestion]').forEach(button=>button.addEventListener('click',()=>{ui.searchInput.value=button.dataset.searchSuggestion;search(button.dataset.searchSuggestion)}));ui.guideSearch.addEventListener('click',()=>ui.searchInput.focus());ui.guideWave.addEventListener('click',()=>document.getElementById('flowButton').click());ui.guideImport.addEventListener('click',()=>ui.importButton.click());ui.idleSearchButton?.addEventListener('click',()=>{ui.searchInput.focus({preventScroll:true});ui.searchInput.scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'})});ui.idleWaveButton?.addEventListener('click',()=>document.getElementById('flowButton').click());
function setLibraryView(enabled){setQueueOpen(false);setPlayerExpanded(false);if(!ui.themePanel.hidden||!ui.diagnosticsPanel.hidden)closeThemePanel();state.library=enabled;state.hasSearched=enabled;ui.libraryButton.classList.toggle('active',enabled);ui.libraryButton.setAttribute('aria-pressed',String(enabled));ui.searchNavButton.classList.toggle('active',!enabled);ui.searchNavButton.setAttribute('aria-pressed',String(!enabled));setMessage(enabled?t(state.saved.length?'libraryStored':'libraryEmpty'):'');render()}
ui.libraryButton.addEventListener('click',()=>setLibraryView(!state.library));
ui.playPause.addEventListener('click',togglePlayback);ui.previousTrack.addEventListener('click',previousTrack);ui.nextTrack.addEventListener('click',nextTrack);ui.repeatMode.addEventListener('click',cycleRepeatMode);
ui.queueToggle?.addEventListener('click',()=>{if(state.active)setQueueOpen(!ui.player.classList.contains('queue-open'))});ui.queueClose?.addEventListener('click',()=>setQueueOpen(false));ui.expandPlayer?.addEventListener('click',()=>{if(state.active)setPlayerExpanded(true)});ui.collapsePlayer?.addEventListener('click',()=>setPlayerExpanded(false));
ui.closePlayer.addEventListener('click',()=>{setQueueOpen(false);setPlayerExpanded(false);state.playbackGeneration+=1;state.audioTrackId=null;pausePlayback();stopYouTube();stopHls();ui.audio.removeAttribute('src');ui.idleStage.setAttribute('aria-hidden','false');ui.player.classList.remove('track-enter','track-swap');ui.player.classList.add('player-empty');document.body.classList.remove('has-player');state.active=null;ui.nowTitle.textContent=t('nothingPlaying');ui.nowArtist.textContent='AWUN';ui.nowSource.textContent='—';render()});
ui.searchNavButton.addEventListener('click',()=>{setLibraryView(false);state.hasSearched=false;render();ui.searchInput.focus({preventScroll:true});ui.searchInput.scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'})});
ui.clearQueue?.addEventListener('click',()=>{state.queue=[];state.queueMode='manual';persistQueue();render()});
ui.minimizeVideo.addEventListener('click',()=>{ui.youtubeDock.classList.toggle('minimized');ui.minimizeVideo.textContent=ui.youtubeDock.classList.contains('minimized')?'□':'—'});
ui.progress.addEventListener('pointerdown',()=>{state.seeking=true});ui.progress.addEventListener('pointerup',()=>{state.seeking=false;const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;seekTo((Number(ui.progress.value)/1000)*(duration||0),true)});ui.progress.addEventListener('input',()=>{setRange(ui.progress,ui.progress.value);const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;ui.elapsed.textContent=formatTime((Number(ui.progress.value)/1000)*(duration||0))});
ui.volume.addEventListener('input',()=>{setRange(ui.volume,ui.volume.value);const value=Number(ui.volume.value);ui.audio.volume=value/100;try{state.youtube?.setVolume(value)}catch{}ui.muteButton.textContent=t(value?'volume':'mute')});
ui.muteButton.addEventListener('click',()=>{const muted=Number(ui.volume.value)===0;if(muted)setRange(ui.volume,Math.round(state.lastVolume*100)||82);else{state.lastVolume=Number(ui.volume.value)/100;setRange(ui.volume,0)}ui.volume.dispatchEvent(new Event('input'))});
ui.audio.addEventListener('timeupdate',()=>updateTimeline(ui.audio.currentTime,ui.audio.duration));ui.audio.addEventListener('loadedmetadata',()=>updateTimeline(ui.audio.currentTime,ui.audio.duration));ui.audio.addEventListener('play',()=>{setPlaying(true);startWaveformCapture(state.active)});ui.audio.addEventListener('pause',()=>{stopWaveformCapture();setPlaying(false)});ui.audio.addEventListener('ended',()=>{stopWaveformCapture();handleTrackEnded()});ui.audio.addEventListener('error',()=>{stopWaveformCapture();if(state.active?.id===state.audioTrackId)recoverPlayback()});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;ui.installButton.hidden=false});window.addEventListener('appinstalled',()=>{installPrompt=null;ui.installButton.hidden=true;setMessage(t('installed'),'notice')});ui.installButton.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;ui.installButton.hidden=true});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ui.player.classList.contains('queue-open')){setQueueOpen(false);return}if(event.key==='Escape'&&ui.player.classList.contains('expanded-player')){setPlayerExpanded(false);return}if(event.key==='Escape'&&!ui.importPanel.hidden){closeImportPanel();return}if(event.key==='Escape'&&(!ui.themePanel.hidden||!ui.diagnosticsPanel.hidden)){closeThemePanel();return}if(event.code==='Space'&&!['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)&&state.active){event.preventDefault();togglePlayback()}});

async function bootstrap(){
  const url=runtimeParams,requestedRegion=url.get('region')?.toUpperCase(),requestedLimit=Number(url.get('limit'));if(regions.includes(requestedRegion)){state.region=requestedRegion;localStorage.setItem('awun-region',state.region)}if(resultLimits.includes(requestedLimit)){state.resultLimit=requestedLimit;localStorage.setItem('awun-result-limit',String(requestedLimit))}ui.regionSelect.value=state.region;ui.limitSelect.value=String(state.resultLimit);
  if(!playStoreMode&&'serviceWorker'in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});ui.player.hidden=false;ui.player.classList.add('player-empty');applyLanguage();applyVisual(false);applyRepeatMode(false);updateClock();setInterval(updateClock,1000);persist();setRange(ui.volume,82);setRange(ui.progress,0);render();await refreshStatus();
  const query=url.get('q');if(query){ui.searchInput.value=query;search(query)}
}
window.awunApp={state,ui,playTrack,render,search,toggleSave,currentList,setMessage,sourceLabels,decodeText,matchText,loadingRows,awunFetch,requestSearch,pausePlayback,playStoreMode,apiBase,fallbackApiBase,apiUrl,refreshStatus,replaceQueue,appendQueue};
document.addEventListener('awun:language',event=>{language=event.detail.language;applyVisual(false);applyRepeatMode(false);render();renderDiagnostics();refreshStatus()});
bootstrap();
