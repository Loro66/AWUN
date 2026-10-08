const sourceLabels={youtube:'YouTube',soundcloud:'SoundCloud',audius:'Audius',jamendo:'Jamendo',internet_archive:'Internet Archive',yandex_music:'Yandex Music'};
const importTrackLimit=1000;
const regions=['AUTO','CIS','EUROPE','USA','LATAM','ASIA','GLOBAL'];
const resultLimits=[30,60,100];
const i18n=window.awunI18n;
const playerCore=window.awunPlayerCore;
const storage=window.awunStorage;
const runtimeLog=window.awunRuntimeLog;
const updateChecker=window.awunUpdateChecker;
const smartPlaylists=window.songvaleSmartPlaylists;
const t=(key,values={})=>i18n.t(key,values);
const $=id=>document.getElementById(id);
const readStoredJson=(key,fallback)=>storage?.readJSON?.(key,fallback)??fallback;
const readStoredText=(key,fallback=null)=>storage?.readText?.(key,fallback)??fallback;
const writeStoredJson=(key,value,options)=>storage?.writeJSON?.(key,value,options)??false;
const writeStoredText=(key,value,options)=>storage?.writeText?.(key,value,options)??false;
const removeStored=key=>storage?.remove?.(key)??false;
storage?.migrate?.();
const runtimeParams=new URLSearchParams(location.search);
const authFragment=new URLSearchParams(location.hash.slice(1));
let accountRecoveryToken=authFragment.get('type')==='recovery'?authFragment.get('access_token'):null;
if(authFragment.has('access_token')||authFragment.has('error'))history.replaceState(null,'',`${location.pathname}${location.search}`);
const runtimePlatform=runtimeParams.get('platform')||'web';
const playStoreMode=runtimePlatform==='android-play';
const appScript=[...document.scripts].find(script=>/\/app\.js(?:\?|$)/.test(script.src));
const staticAssetVersion=appScript?new URL(appScript.src).searchParams.get('v')||'':'';
const staticAssetUrl=file=>`/static/${file}${staticAssetVersion?`?v=${encodeURIComponent(staticAssetVersion)}`:''}`;
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
const remoteFallbackTimeoutMs=12000;
const searchTimeoutMs=14000;
const importSearchTimeoutMs=40000;
const playbackLookupTimeoutMs=7000;
async function withDeadline(signal, timeoutMs, operation) {
  const controller=new AbortController();
  const relay=()=>controller.abort(signal?.reason);
  if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let deferred=false;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',relay)};
  try{
    const result=await operation(controller.signal);
    if(result?.supplement){deferred=true;result.supplement=result.supplement.finally(cleanup)}
    return result;
  }
  catch(error){if(controller.signal.aborted&&!signal?.aborted)throw new Error(t('requestTimedOut'));throw error}
  finally{if(!deferred)cleanup()}
}
function endpointUrl(base,input){return base&&typeof input==='string'&&input.startsWith('/')?`${base}${input}`:input}
function apiUrl(input){return endpointUrl(apiBase,input)}
function fallbackApiUrl(input){return endpointUrl(fallbackApiBase,input)}
function requestOptions(init={}){
  const headers=new Headers(init.headers||{});
  if(playStoreMode)headers.set('X-AWUN-Client','android-play');
  return{...init,headers};
}
async function awunFetch(input,init={}){
  const options=requestOptions(init),target=apiUrl(input);
  const backup=apiBase&&target!==input&&typeof input==='string'?input:
    fallbackApiBase&&typeof input==='string'&&input.startsWith('/')?fallbackApiUrl(input):null;
  let response;
  try{response=await fetch(target,options)}
  catch(error){if(options.signal?.aborted||!backup)throw error;return fetch(backup,options)}
  return backup&&remoteRetryStatuses.has(response.status)?fetch(backup,options):response;
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
function markFreshTracks(tracks){
  const resolvedAt=Date.now();
  (Array.isArray(tracks)?tracks:[]).forEach(track=>{
    if(track?.source!=='youtube'&&track?.source!=='yandex_music')track.stream_resolved_at=resolvedAt;
    freshTracksByKey.set(trackSessionKey(track),track);
  });
}
const youtubeFailureKey='awun-youtube-failures-v1';
const youtubeFailureTtlMs=24*60*60*1000;
function loadYoutubeFailures(){
  const value=readStoredJson(youtubeFailureKey,{}),now=Date.now(),active={};
  if(value&&typeof value==='object'&&!Array.isArray(value))Object.entries(value).forEach(([id,entry])=>{if(id&&entry&&now-(Number(entry.at)||0)<youtubeFailureTtlMs)active[id]=entry});
  return active;
}
const youtubeFailures=loadYoutubeFailures();
function youtubeVideoId(track){if(track?.id?.startsWith('yt_'))return track.id.slice(3);try{return new URL(track?.stream_url).searchParams.get('v')||''}catch{return''}}
function youtubeRecentlyFailed(track){const id=youtubeVideoId(track),entry=youtubeFailures[id];return Boolean(entry&&Date.now()-(Number(entry.at)||0)<youtubeFailureTtlMs)}
function markYoutubeFailed(track,code){const id=youtubeVideoId(track);if(!id)return;youtubeFailures[id]={at:Date.now(),code:String(code??'unknown').slice(0,24)};writeStoredJson(youtubeFailureKey,youtubeFailures);runtimeLog?.log?.('youtube.video-unavailable',{id,code},'warning')}
function clearYoutubeFailure(track){const id=youtubeVideoId(track);if(!id||!youtubeFailures[id])return;delete youtubeFailures[id];writeStoredJson(youtubeFailureKey,youtubeFailures)}
function playableSearchTracks(tracks){return(Array.isArray(tracks)?tracks:[]).filter(track=>track?.source!=='youtube'||!youtubeRecentlyFailed(track))}
const searchCacheKey='awun-search-cache-v1';
const searchCacheTtlMs=30*60*1000;
const searchCacheLimit=8;
function searchCacheId(query,sources,region,limit){return JSON.stringify([matchText(query),[...sources].sort(),region,limit])}
function loadSearchCache(){
  const now=Date.now(),value=readStoredJson(searchCacheKey,[]);
  if(!Array.isArray(value))return[];
  return value.filter(entry=>{
    const grouped=entry?.data?.tracks_by_source;
    return entry?.id&&now-(Number(entry.stored_at)||0)<searchCacheTtlMs&&Array.isArray(entry.data?.tracks)&&grouped&&typeof grouped==='object'&&!Array.isArray(grouped)&&Object.values(grouped).every(Array.isArray);
  }).slice(0,searchCacheLimit);
}
function cachedSearch(id){return loadSearchCache().find(entry=>entry.id===id)?.data||null}
function rememberSearch(id,data){
  const entries=loadSearchCache().filter(entry=>entry.id!==id);
  entries.unshift({id,stored_at:Date.now(),data});
  writeStoredJson(searchCacheKey,entries.slice(0,searchCacheLimit),{backup:false});
}
async function readSearchData(response){
  const data=await response.json();
  if(!response.ok)throw new Error(data.detail||t('searchFailed'));
  data.tracks=playableSearchTracks(data.tracks);
  data.total=data.tracks.length;
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
function fallbackSearch(payload,signal,timeoutMs=remoteFallbackTimeoutMs){
  const controller=new AbortController();
  const relayAbort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)relayAbort();else signal?.addEventListener('abort',relayAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const options=requestOptions({method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify(payload)});
  return fetch(fallbackApiUrl('/api/v1/search'),options).then(readSearchData).catch(error=>{
    if(error?.name==='AbortError'&&!signal?.aborted)throw new Error(t('searchUnavailable'));
    throw error;
  }).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',relayAbort)});
}
function requestSearch(payload,{signal,waitForFallback=false,timeoutMs}={}){
  const budget=(timeoutMs||(payload.fast?playbackLookupTimeoutMs:searchTimeoutMs))+(timeoutMs&&fallbackApiBase&&!apiBase?8000:0);
  return withDeadline(signal,budget,
    boundedSignal=>requestSearchWithinDeadline(payload,{signal:boundedSignal,waitForFallback,timeoutMs}));
}
async function requestSearchWithinDeadline(payload,{signal,waitForFallback=false,timeoutMs}={}){
  const options=requestOptions({method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(payload)});
  if(!fallbackApiBase||apiBase){return{data:await readSearchData(await awunFetch('/api/v1/search',options)),supplement:null}}
  let local;
  try{local=await withDeadline(signal,payload.fast?3500:8000,localSignal=>fetch('/api/v1/search',{...options,signal:localSignal}).then(readSearchData))}
  catch(error){if(error?.name==='AbortError')throw error;return{data:await fallbackSearch(payload,signal,timeoutMs),supplement:null}}
  const requested=Array.isArray(payload.sources)?payload.sources:[];
  const failed=requested.filter(source=>Object.prototype.hasOwnProperty.call(local.errors||{},source));
  if(!failed.length)return{data:local,supplement:null};
  const remote=fallbackSearch({...payload,sources:failed},signal,timeoutMs).then(data=>mergeSearchData(local,data,failed));
  if(waitForFallback){
    try{return{data:(await remote)||local,supplement:null}}
    catch(error){if(error?.name==='AbortError'&&signal?.aborted)throw error;return{data:local,supplement:null}}
  }
  return{data:local,supplement:remote.catch(()=>null)};
}
const ui={
  searchNavButton:$('searchNavButton'),libraryButton:$('libraryButton'),allSourcesButton:$('allSourcesButton'),installButton:$('installButton'),iosInstallGuide:$('iosInstallGuide'),iosInstallDismiss:$('iosInstallDismiss'),languageButton:$('languageButton'),languageLabel:$('languageLabel'),emptyGuide:$('emptyGuide'),idleStage:$('idleStage'),idleSearchButton:$('idleSearchButton'),idleWaveButton:$('idleWaveButton'),guideSearch:$('guideSearch'),guideWave:$('guideWave'),guideImport:$('guideImport'),welcomePanel:$('welcomePanel'),welcomeImport:$('welcomeImport'),welcomeSearch:$('welcomeSearch'),welcomeLibraryCount:$('welcomeLibraryCount'),searchForm:$('searchForm'),searchInput:$('searchInput'),searchButton:$('searchButton'),homeSections:$('homeSections'),recentList:$('recentList'),recommendationGrid:$('recommendationGrid'),queueList:$('queueList'),queueEmpty:$('queueEmpty'),clearQueue:$('clearQueue'),sidebarQueue:$('sidebarQueue'),sidebarRecent:$('sidebarRecent'),sidebarQueueAll:$('sidebarQueueAll'),sidebarRecentAll:$('sidebarRecentAll'),
  sources:$('sources'),regionSelect:$('regionSelect'),limitSelect:$('limitSelect'),results:$('results'),trackList:$('trackList'),message:$('message'),resultTitle:$('resultTitle'),resultCount:$('resultCount'),resultTime:$('resultTime'),searchMeta:$('searchMeta'),libraryWorkspace:$('libraryWorkspace'),libraryFilter:$('libraryFilter'),playlistCreate:$('playlistCreate'),playlistName:$('playlistName'),playlistTabs:$('playlistTabs'),playlistActions:$('playlistActions'),playlistDescription:$('playlistDescription'),libraryEmptyState:$('libraryEmptyState'),deletePlaylist:$('deletePlaylist'),
  player:$('player'),playerArtwork:$('playerArtwork'),nowTitle:$('nowTitle'),nowArtist:$('nowArtist'),playerStatus:$('playerStatus'),nowSource:$('nowSource'),audio:$('audio'),youtubeDock:$('youtubeDock'),youtubePlayer:$('youtubePlayer'),
  previousTrack:$('previousTrack'),playPause:$('playPause'),nextTrack:$('nextTrack'),repeatMode:$('repeatMode'),waveProgress:$('waveProgress'),progress:$('progress'),elapsed:$('elapsed'),totalTime:$('totalTime'),volume:$('volume'),muteButton:$('muteButton'),playerSave:$('playerSave'),closePlayer:$('closePlayer'),minimizeVideo:$('minimizeVideo'),queueToggle:$('queueToggle'),queueClose:$('queueClose'),expandPlayer:$('expandPlayer'),collapsePlayer:$('collapsePlayer'),
  themeButton:$('themeButton'),themeLabel:$('themeLabel'),themePanel:$('themePanel'),themeClose:$('themeClose'),themeBackdrop:$('themeBackdrop'),themeColor:$('themeColor'),motionToggle:$('motionToggle'),motionValue:$('motionValue'),decorToggle:$('decorToggle'),decorValue:$('decorValue'),densityToggle:$('densityToggle'),densityValue:$('densityValue'),soundEngineToggle:$('soundEngineToggle'),soundEngineValue:$('soundEngineValue'),soundEngineStatus:$('soundEngineStatus'),diagnosticsButton:$('diagnosticsButton'),diagnosticsPanel:$('diagnosticsPanel'),diagnosticsClose:$('diagnosticsClose'),diagnosticsRefresh:$('diagnosticsRefresh'),diagnosticsCopy:$('diagnosticsCopy'),diagnosticsList:$('diagnosticsList'),diagnosticsEndpoint:$('diagnosticsEndpoint'),diagnosticsChecked:$('diagnosticsChecked'),diagnosticsCopyStatus:$('diagnosticsCopyStatus'),diagnosticsToolsStatus:$('diagnosticsToolsStatus'),diagnosticsLog:$('diagnosticsLog'),storageExport:$('storageExport'),storageImport:$('storageImport'),storageImportFile:$('storageImportFile'),updateCheck:$('updateCheck'),updateLink:$('updateLink'),
  importButton:$('importButton'),importPanel:$('importPanel'),importClose:$('importClose'),importBackdrop:$('importBackdrop'),libraryFile:$('libraryFile'),importFileButton:$('importFileButton'),importFileName:$('importFileName'),importText:$('importText'),importStatus:$('importStatus'),importSubmit:$('importSubmit'),importUrl:$('importUrl'),importUrlSubmit:$('importUrlSubmit'),importPlaylistName:$('importPlaylistName'),importProgress:$('importProgress'),importReportTitle:$('importReportTitle'),importTotal:$('importTotal'),importProcessed:$('importProcessed'),importAdded:$('importAdded'),importReviewCount:$('importReviewCount'),importMissed:$('importMissed'),importPercent:$('importPercent'),importCancel:$('importCancel'),importResume:$('importResume'),importRetryMissed:$('importRetryMissed'),importDownloadReport:$('importDownloadReport'),importOpenLibrary:$('importOpenLibrary'),importReviewPanel:$('importReviewPanel'),importReviewTitle:$('importReviewTitle'),importReviewPosition:$('importReviewPosition'),importReviewOriginal:$('importReviewOriginal'),importReviewCandidates:$('importReviewCandidates'),importReviewSearchInput:$('importReviewSearchInput'),importReviewSearchButton:$('importReviewSearchButton'),importReviewSkip:$('importReviewSkip')
};
Object.assign(ui,Object.fromEntries(['accountBadge','accountStatus','accountForm','accountEmail','accountPassword','accountLogin','accountSignup','accountForgot','accountRecoveryForm','accountNewPassword','accountConnected','accountIdentity','accountAvatar','accountEmailDisplay','accountTrackCount','accountPlaylistCount','accountProfileForm','accountDisplayName','accountSaveProfile','accountSync','accountLogout','accountDeletePassword','accountDeleteConfirm','accountChoice','accountChoiceText','accountMerge','accountUseCloud','portableExport','portableImport','portableFile','portablePreview','portablePreviewText','portableMerge','portableReplace','portableCancel','portableStatus'].map(id=>[id,$(id)])));
const sourceButtonElements=[...ui.sources.querySelectorAll('button[data-source]')];
const sourceChoiceKey='awun-selected-sources-v1';
const knownSearchSources=sourceButtonElements.map(button=>button.dataset.source);
const storedSourceChoice=readStoredJson(sourceChoiceKey,null);
const preferredSources=new Set(Array.isArray(storedSourceChoice)?storedSourceChoice.filter(source=>knownSearchSources.includes(source)):knownSearchSources);
const themeChoiceButtons=[...document.querySelectorAll('[data-theme-choice]')];
const audioProfileButtons=[...document.querySelectorAll('[data-audio-profile]')];
window.addEventListener('awun:storage-error',()=>{if(ui.diagnosticsToolsStatus)ui.diagnosticsToolsStatus.textContent=t('storageSaveFailed')});

function loadLibrary(){const value=readStoredJson('awun-library',[]);return Array.isArray(value)?value:[]}
const playlistsKey='awun-playlists-v1';
function loadPlaylists(){
  const value=readStoredJson(playlistsKey,[]);
  if(!Array.isArray(value))return[];
  return value.filter(list=>list&&typeof list.id==='string'&&typeof list.name==='string'&&Array.isArray(list.items))
    .slice(0,25).map(list=>({...list,name:list.name.slice(0,60),items:list.items.filter(item=>item?.track?.id&&item.track?.source&&Number.isFinite(item.position)).slice(0,1000)}));
}
function loadRegion(){const value=readStoredText('awun-region','AUTO');return regions.includes(value)?value:'AUTO'}
function loadResultLimit(){const value=Number(readStoredText('awun-result-limit','60'));return resultLimits.includes(value)?value:60}
function loadRepeatMode(){const value=readStoredText('awun-repeat-mode','off');return ['off','all','one'].includes(value)?value:'off'}
function loadRecents(){const value=readStoredJson('awun-recent',[]);return Array.isArray(value)?value.filter(item=>item&&item.id):[]}
function loadQueueState(){
  const value=readStoredJson('awun-queue-v1',{}),items=Array.isArray(value)?value:value.items;
  return{items:playerCore.uniqueTracks(items),mode:value?.mode==='manual'?'manual':'context'};
}
function loadVisual(){const value=readStoredJson('awun-visual',{});return{theme:['black','white','acid','ultraviolet','cobalt','ember'].includes(value?.theme)?value.theme:'black',motion:value?.motion==='off'?'off':'on',decor:value?.decor==='minimal'?'minimal':'full',density:['compact','standard','airy'].includes(value?.density)?value.density:'standard'}}
function loadAudioPreferences(){const value=readStoredJson('songvale-audio-v1',{});return{audioProfile:['neutral','warm','clarity'].includes(value?.profile)?value.profile:'neutral',audioProcessing:value?.enabled!==false}}
function loadLineComments(){const value=readStoredJson('awun-line-comments-v1',{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function loadImportSession(){
  const value=readStoredJson('songvale-import-session-v1',null);
  if(!value||value.version!==1||!Number.isFinite(Number(value.total)))return null;
  const stopped=Boolean(value.stopped||(value.pendingTracks||[]).length);
  return{...value,running:false,stopped,titleKey:stopped?'transferStopped':value.titleKey,statusKey:stopped?'importStopped':value.statusKey,statusValues:stopped?{processed:value.processed,total:value.total,added:value.added}:value.statusValues};
}
const playbackSessionKey='awun-playback-session-v1';
const playbackSessionTtlMs=30*24*60*60*1000;
function loadPlaybackSession(){
  const value=readStoredJson(playbackSessionKey,null),track=value?.track;
  if(!value||value.version!==1||!track?.id||!track?.source||!track?.title||Date.now()-(Number(value.saved_at)||0)>playbackSessionTtlMs)return null;
  return{track,position:Math.max(0,Number(value.position)||0),duration:Math.max(0,Number(value.duration)||Number(track.duration)||0)};
}
const visualThemes={black:{labelKey:'themeBlackShort',color:'#030604'},white:{labelKey:'themeWhiteShort',color:'#e7e8df'},acid:{labelKey:'themeAcidShort',color:'#050a05'},ultraviolet:{labelKey:'themeUltravioletShort',color:'#07050c'},cobalt:{labelKey:'themeCobaltShort',color:'#040a0e'},ember:{labelKey:'themeEmberShort',color:'#080704'}};
const restoredQueue=loadQueueState();
const state={
  tracks:[],saved:loadLibrary(),playlists:loadPlaylists(),activePlaylistId:null,libraryQuery:'',recents:loadRecents(),queue:restoredQueue.items,queueMode:restoredQueue.mode,available:new Set(),preferredSources,sources:new Set(preferredSources),region:loadRegion(),resultLimit:loadResultLimit(),repeatMode:loadRepeatMode(),library:false,hasSearched:false,active:null,controller:null,
  youtube:null,youtubeApi:null,youtubeTicker:null,youtubeStartTimer:null,hls:null,hlsApi:null,audioGraph:null,audioEngine:null,waveformCapture:null,waveformCaptureFrame:null,seeking:false,isPlaying:false,timelineSecond:-1,lastPlaybackPersistSecond:-1,restoredPlayback:false,recoveringGeneration:null,sameSourceRefreshGeneration:null,playbackGeneration:0,audioTrackId:null,failedSources:new Set(),failedTrackIds:new Set(),playbackOrigin:null,playbackPosition:0,lastVolume:.82,expanded:null,details:new Map(),detailsController:null,openLines:new Set(),lineComments:loadLineComments(),geniusEnabled:false,diagnostics:null,playbackHealth:{},...loadVisual(),...loadAudioPreferences()
};
let installPrompt=null;
let language=i18n.language;
let homeHub=null;
let importController=null,importPreviewTimer=null;
let latestImportReport=loadImportSession();
ui.importFailed=$('importFailed');
const accountOwnerKey='songvale-account-owner-v1';
const accountSyncKey=id=>`songvale-account-sync-${id}`;
const backupRestoreKey='songvale-backup-restore-pending-v1';
let accountUser=null,accountAvailable=false,accountStatusKey='accountChecking',accountChoice=null,accountRevision=0,accountDirty=false,accountGeneration=0,accountTimer=null,accountBusy=false,accountRetryMs=2000,accountSyncedSignature='',accountEpoch=0;
let lastAccountRefresh=0;
let portablePending=null,portableStatusKey='';
function accountStatus(key){accountStatusKey=key;ui.accountStatus.textContent=t(key)}
function restorePending(){return Boolean(accountUser&&readStoredText(backupRestoreKey,'')===accountUser.id)}
function clearRestorePending(){if(restorePending())removeStored(backupRestoreKey)}
function renderAccountStatus(){
  state.accountConnected=Boolean(accountUser);
  ui.accountBadge.textContent=t(accountUser?'accountConnectedBadge':'accountGuest');
  ui.accountForm.hidden=!accountAvailable||Boolean(accountUser)||Boolean(accountRecoveryToken);
  ui.accountRecoveryForm.hidden=!accountAvailable||!accountRecoveryToken;
  ui.accountConnected.hidden=!accountUser;
  const identity=accountUser?.display_name||accountUser?.email?.split('@')[0]||'';
  ui.accountIdentity.textContent=identity;
  ui.accountAvatar.textContent=identity?Array.from(identity)[0].toUpperCase():'♫';
  ui.accountEmailDisplay.textContent=accountUser?.email||'';
  ui.accountTrackCount.textContent=String(state.saved.length);
  ui.accountPlaylistCount.textContent=String(state.playlists.length);
  ui.accountSync.disabled=accountBusy||Boolean(accountChoice);
  if(accountUser&&ui.accountDisplayName.dataset.userId!==accountUser.id){ui.accountDisplayName.value=accountUser.display_name||'';ui.accountDisplayName.dataset.userId=accountUser.id}
  if(!accountUser)delete ui.accountDisplayName.dataset.userId;
  ui.accountChoice.hidden=!accountChoice;
  if(accountChoice){ui.accountChoiceText.textContent=t(accountChoice==='other'?'accountOtherChoice':accountChoice==='guest'?'accountGuestChoice':accountChoice==='restore'?'accountRestoreChoice':'accountConflict');ui.accountMerge.hidden=accountChoice==='other'}
  ui.accountStatus.textContent=t(accountStatusKey);
  if(portablePending)renderPortablePreview();
  homeHub?.render();
}
async function accountRequest(path,{method='GET',body}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(`/api/v1/account/${path}`,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    let payload;try{payload=await response.json()}catch{payload=null}
    if(!response.ok){const error=new Error('Account request failed');error.status=response.status;throw error}
    return payload;
  }finally{clearTimeout(timer)}
}
function localAccountCopy(){return{library:loadLibrary(),playlists:loadPlaylists()}}
function accountCopy(){return{library:state.saved,playlists:state.playlists}}
function copyHasMusic(copy){return Boolean(copy.library.length||copy.playlists.length)}
function applyAccountCopy(copy){
  const previous=localAccountCopy();
  if(!writeStoredJson('awun-library',copy.library)||!writeStoredJson(playlistsKey,copy.playlists)){
    writeStoredJson('awun-library',previous.library);writeStoredJson(playlistsKey,previous.playlists);
    accountStatus('accountSyncFailed');return false;
  }
  state.saved=copy.library;state.playlists=copy.playlists;
  if(!state.playlists.some(list=>list.id===state.activePlaylistId))state.activePlaylistId=null;
  ui.playlistTabs.dataset.rendered='';updateLibraryCount();render();renderAccountStatus();return true;
}
function mergeAccountCopies(remote,local){
  const tracks=new Map(remote.library.map(track=>[trackSessionKey(track),track]));
  local.library.forEach(track=>{if(!tracks.has(trackSessionKey(track))){if(tracks.size>=1500)throw new Error('accountLimit');tracks.set(trackSessionKey(track),track)}});
  const lists=new Map(remote.playlists.map(list=>[list.id,list]));
  local.playlists.forEach(list=>{
    const existing=lists.get(list.id);
    if(!existing){if(lists.size>=25)throw new Error('accountLimit');lists.set(list.id,list);return}
    const items=new Map(existing.items.map(item=>[trackSessionKey(item.track),item]));
    let nextPosition=Math.max(0,...existing.items.map(item=>item.position));
    list.items.forEach(item=>{if(!items.has(trackSessionKey(item.track))){if(items.size>=1000)throw new Error('accountLimit');items.set(trackSessionKey(item.track),{...item,position:++nextPosition})}});
    lists.set(list.id,{...existing,items:[...items.values()]});
  });
  return{library:[...tracks.values()],playlists:[...lists.values()]};
}
function librarySignature(copy){
  const serialized=JSON.stringify([copy.library,copy.playlists]);let hash=2166136261;
  for(let index=0;index<serialized.length;index+=1)hash=Math.imul(hash^serialized.charCodeAt(index),16777619);
  return `${serialized.length}:${hash>>>0}`;
}
function sameAccountCopy(left,right){
  try{return JSON.stringify(portableCopy(left))===JSON.stringify(portableCopy(right))}catch{return false}
}
function saveAccountMetadata(){if(accountUser)writeStoredJson(accountSyncKey(accountUser.id),{revision:accountRevision,dirty:accountDirty,signature:accountSyncedSignature},{backup:false})}
function scheduleAccountSync(delay){clearTimeout(accountTimer);accountTimer=setTimeout(()=>void syncAccount(),delay)}
function markAccountDirty(){
  if(!accountUser){
    const owner=readStoredText(accountOwnerKey,'');
    if(owner){const previous=readStoredJson(accountSyncKey(owner),{revision:0});writeStoredJson(accountSyncKey(owner),{revision:previous.revision||0,dirty:true},{backup:false})}
    return;
  }
  accountDirty=true;accountGeneration++;saveAccountMetadata();
  renderAccountStatus();
  if(!accountChoice)scheduleAccountSync(800);
}
async function syncAccount(restoreApproved=false){
  if(!accountUser||accountChoice||accountBusy)return;
  if(restorePending()&&!restoreApproved){accountChoice='restore';accountStatus('accountRestoreChoice');renderAccountStatus();return}
  const epoch=accountEpoch;
  accountBusy=true;lastAccountRefresh=Date.now();accountStatus('accountSyncing');
  try{
    if(!accountDirty){
      const generation=accountGeneration;
      const remote=await accountRequest('library');
      if(epoch!==accountEpoch)return;
      if(accountDirty||generation!==accountGeneration){accountChoice='conflict';accountStatus('accountConflict');renderAccountStatus();return}
      if(remote.revision!==accountRevision){
        if(!applyAccountCopy(remote))return;
        accountRevision=remote.revision;saveAccountMetadata();
      }
      accountSyncedSignature=librarySignature(accountCopy());saveAccountMetadata();
    }else{
      const generation=accountGeneration;
      const copy=accountCopy();
      const result=await accountRequest('library',{method:'PUT',body:{revision:accountRevision,...copy}});
      if(epoch!==accountEpoch)return;
      accountRevision=result.revision;accountDirty=generation!==accountGeneration;saveAccountMetadata();
      accountSyncedSignature=librarySignature(copy);saveAccountMetadata();
      if(!accountDirty)clearRestorePending();
      if(accountDirty)scheduleAccountSync(100);
    }
    accountRetryMs=2000;
    accountStatus(accountDirty?'accountSyncing':'accountSignedIn');
  }catch(error){
    if(epoch!==accountEpoch)return;
    if(error.status===409){
      try{
        const remote=await accountRequest('library');
        if(epoch!==accountEpoch)return;
        if(sameAccountCopy(remote,accountCopy())){
          accountRevision=remote.revision;accountDirty=false;accountSyncedSignature=librarySignature(accountCopy());saveAccountMetadata();clearRestorePending();accountRetryMs=2000;accountStatus('accountSignedIn');
        }else{accountChoice=restorePending()?'restore':'conflict';accountStatus(accountChoice==='restore'?'accountRestoreChoice':'accountConflict');renderAccountStatus()}
      }catch{if(epoch!==accountEpoch)return;accountStatus('accountSyncFailed');scheduleAccountSync(accountRetryMs);accountRetryMs=Math.min(accountRetryMs*2,60000)}
    }
    else if(error.status===401){
      saveAccountMetadata();clearTimeout(accountTimer);accountUser=null;accountChoice=null;
      accountEpoch++;accountBusy=false;
      accountStatus('accountSessionExpired');renderAccountStatus();
    }else if(error.status===413||error.status===422){accountStatus(error.status===413?'accountLimit':'accountSyncInvalid')}
    else{
      accountStatus('accountSyncFailed');
      if(restorePending()){accountChoice='restore';renderAccountStatus()}
      else if(accountDirty&&!accountChoice){scheduleAccountSync(accountRetryMs);accountRetryMs=Math.min(accountRetryMs*2,60000)}
    }
  }finally{if(epoch===accountEpoch)accountBusy=false}
}
async function connectAccount(user){
  const epoch=++accountEpoch;
  accountUser=user;accountAvailable=true;accountChoice=null;accountBusy=true;renderAccountStatus();
  const priorOwner=readStoredText(accountOwnerKey,'');
  if(priorOwner&&priorOwner!==user.id){state.saved=[];state.playlists=[];updateLibraryCount();render()}
  const generation=accountGeneration;
  let syncAfterConnect=false;
  try{
    const remote=await accountRequest('library');
    if(epoch!==accountEpoch)return;
    const owner=readStoredText(accountOwnerKey,''),local=localAccountCopy();
    const metadata=readStoredJson(accountSyncKey(user.id),{});
    accountRevision=remote.revision;accountSyncedSignature=typeof metadata.signature==='string'?metadata.signature:'';
    accountDirty=Boolean(metadata.dirty||owner===user.id&&metadata.signature&&metadata.signature!==librarySignature(local)||owner===user.id&&generation!==accountGeneration);
    if(owner&&owner!==user.id&&copyHasMusic(local))accountChoice='other';
    else if(restorePending())accountChoice='restore';
    else if(!owner&&copyHasMusic(local))accountChoice='guest';
    else if(owner===user.id&&accountDirty){
      accountRevision=Number.isInteger(metadata.revision)?metadata.revision:0;
      if(accountRevision!==remote.revision&&sameAccountCopy(remote,local)){
        accountRevision=remote.revision;accountDirty=false;accountSyncedSignature=librarySignature(local);writeStoredText(accountOwnerKey,user.id,{backup:false});saveAccountMetadata();accountStatus('accountSignedIn');
      }else if(accountRevision!==remote.revision)accountChoice='conflict';
      else{writeStoredText(accountOwnerKey,user.id,{backup:false});saveAccountMetadata();syncAfterConnect=true}
    }else if(applyAccountCopy(remote)){
      writeStoredText(accountOwnerKey,user.id,{backup:false});
      accountSyncedSignature=librarySignature(accountCopy());saveAccountMetadata();accountStatus('accountSignedIn');
    }
    if(accountChoice)accountStatus(accountChoice==='restore'?'accountRestoreChoice':accountChoice==='conflict'?'accountConflict':accountChoice==='other'?'accountOtherChoice':'accountGuestChoice');
  }catch{if(epoch!==accountEpoch)return;accountStatus('accountOffline')}
  finally{if(epoch===accountEpoch)accountBusy=false}
  if(epoch!==accountEpoch)return;
  renderAccountStatus();
  if(syncAfterConnect)void syncAccount();
}
async function initializeAccount(){
  try{
    const config=await accountRequest('config');accountAvailable=config.enabled===true;
    if(!accountAvailable){accountStatus('accountUnavailable');renderAccountStatus();return}
    if(accountRecoveryToken){accountStatus('accountRecoveryPrompt');renderAccountStatus();return}
    renderAccountStatus();
    try{await connectAccount(await accountRequest('session'))}
    catch(error){accountStatus(error.status===401?'accountGuestStatus':'accountOffline');renderAccountStatus()}
  }catch{accountStatus('accountOffline');renderAccountStatus()}
}
async function accountSignIn(action){
  if(!ui.accountForm.reportValidity())return;
  const email=ui.accountEmail.value.trim(),password=ui.accountPassword.value;
  ui.accountLogin.disabled=ui.accountSignup.disabled=true;
  try{
    const result=await accountRequest(action,{method:'POST',body:{email,password}});
    ui.accountPassword.value='';
    if(action==='signup'&&result.pending){accountStatus('accountPending');return}
    await connectAccount(await accountRequest('session'));
  }catch{accountStatus('accountError')}
  finally{ui.accountLogin.disabled=ui.accountSignup.disabled=false}
}
ui.accountForm.addEventListener('submit',event=>{event.preventDefault();void accountSignIn('login')});
ui.accountSignup.addEventListener('click',()=>void accountSignIn('signup'));
ui.accountForgot.addEventListener('click',async()=>{
  if(!ui.accountEmail.reportValidity())return;
  ui.accountForgot.disabled=true;
  try{await accountRequest('recover',{method:'POST',body:{email:ui.accountEmail.value.trim()}});accountStatus('accountRecoverSent')}
  catch{accountStatus('accountError')}
  finally{ui.accountForgot.disabled=false}
});
ui.accountRecoveryForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!accountRecoveryToken||!ui.accountRecoveryForm.reportValidity())return;
  const button=ui.accountRecoveryForm.querySelector('button[type="submit"]');button.disabled=true;
  try{
    await accountRequest('recover/complete',{method:'POST',body:{access_token:accountRecoveryToken,password:ui.accountNewPassword.value}});
    accountRecoveryToken=null;ui.accountNewPassword.value='';accountStatus('accountRecoveryDone');renderAccountStatus();
  }catch{accountStatus('accountError')}
  finally{button.disabled=false}
});
ui.accountSync.addEventListener('click',()=>void syncAccount());
ui.accountMerge.addEventListener('click',async()=>{
  if(!accountUser||accountChoice==='other')return;
  const prior=accountChoice,epoch=accountEpoch;
  try{
    const remote=await accountRequest('library');
    if(epoch!==accountEpoch)return;
    if(!applyAccountCopy(mergeAccountCopies(remote,localAccountCopy())))return;
    accountRevision=remote.revision;accountChoice=null;writeStoredText(accountOwnerKey,accountUser.id,{backup:false});
    accountDirty=true;accountGeneration++;saveAccountMetadata();renderAccountStatus();await syncAccount(prior==='restore');
    if(prior==='restore'&&restorePending()&&!accountChoice){accountChoice='restore';accountStatus('accountRestoreChoice');renderAccountStatus()}
  }catch(error){if(epoch!==accountEpoch)return;accountChoice=prior;accountStatus(error.message==='accountLimit'?'accountLimit':'accountSyncFailed');renderAccountStatus()}
});
ui.accountUseCloud.addEventListener('click',async()=>{
  if(!accountUser)return;
  const epoch=accountEpoch;
  try{
    const remote=await accountRequest('library');
    if(epoch!==accountEpoch)return;
    if(!applyAccountCopy(remote))return;
    accountRevision=remote.revision;accountDirty=false;accountChoice=null;
    accountSyncedSignature=librarySignature(accountCopy());
    writeStoredText(accountOwnerKey,accountUser.id,{backup:false});saveAccountMetadata();clearRestorePending();accountStatus('accountSignedIn');renderAccountStatus();
  }catch{if(epoch===accountEpoch)accountStatus('accountSyncFailed')}
});
async function leaveAccount(deleteAccount=false){
  if(!accountUser)return;
  if(importController){accountStatus('accountImportBusy');return}
  const preserveLocal=accountChoice==='guest'||accountChoice==='other';
  if(!deleteAccount&&!preserveLocal&&(accountDirty||accountChoice||accountBusy)){accountStatus('accountLogoutPending');return}
  if(deleteAccount&&!confirm(t('accountDeletePrompt')))return;
  const user=accountUser,password=ui.accountDeletePassword.value,epoch=accountEpoch;
  if(deleteAccount&&password.length<12){accountStatus('accountError');return}
  try{
    await accountRequest(deleteAccount?'delete':'logout',{method:'POST',body:deleteAccount?{email:user.email,password}:undefined});
    if(epoch!==accountEpoch)return;
    ui.accountDeletePassword.value='';clearTimeout(accountTimer);
    if(preserveLocal){
      const local=localAccountCopy();accountUser=null;accountRevision=0;accountDirty=false;accountChoice=null;accountSyncedSignature='';removeStored(accountSyncKey(user.id));
      state.saved=local.library;state.playlists=local.playlists;updateLibraryCount();render();accountStatus('accountGuestStatus');renderAccountStatus();return;
    }
    const libraryCleared=writeStoredJson('awun-library',[]),playlistsCleared=writeStoredJson(playlistsKey,[]);
    state.saved=[];state.playlists=[];state.activePlaylistId=null;ui.playlistTabs.dataset.rendered='';updateLibraryCount();render();
    ui.closePlayer.click();
    state.recents=[];persistRecents();state.queue=[];persistQueue();
    latestImportReport=null;removeStored('songvale-import-session-v1');
    accountUser=null;accountRevision=0;accountDirty=false;accountChoice=null;accountSyncedSignature='';
    removeStored(accountOwnerKey);removeStored(accountSyncKey(user.id));
    const backupCleared=await storage?.backupNow?.();
    accountStatus(libraryCleared&&playlistsCleared&&backupCleared!==false?'accountGuestStatus':'accountLocalCleanupFailed');renderAccountStatus();
  }catch{accountStatus('accountError')}
}
ui.accountLogout.addEventListener('click',()=>void leaveAccount());
ui.accountDeleteConfirm.addEventListener('click',()=>void leaveAccount(true));
ui.accountProfileForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!accountUser||!ui.accountProfileForm.reportValidity())return;
  const name=ui.accountDisplayName.value.trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>40){accountStatus('accountProfileFailed');return}
  const epoch=accountEpoch;
  ui.accountSaveProfile.disabled=true;
  try{
    const updated=await accountRequest('profile',{method:'PUT',body:{display_name:name}});
    if(epoch!==accountEpoch||updated.id!==accountUser?.id)return;
    accountUser=updated;ui.accountDisplayName.value=updated.display_name;renderAccountStatus();accountStatus('accountProfileSaved');
  }catch{if(epoch===accountEpoch)accountStatus('accountProfileFailed')}
  finally{ui.accountSaveProfile.disabled=false}
});

const portableTrackFields=['source','id','title','artist','duration','quality','thumbnail','external_url','catalog_links','import_origin','is_preview'];
function portableTrack(track){
  if(!track||typeof track!=='object'||Array.isArray(track))throw new Error('invalid track');
  for(const [key,limit] of [['source',40],['id',200],['title',300],['artist',300]]){
    if(typeof track[key]!=='string'||!track[key]||track[key].length>limit)throw new Error('invalid track');
  }
  const result=Object.fromEntries(portableTrackFields.filter(key=>Object.hasOwn(track,key)&&track[key]!=null).map(key=>[key,track[key]]));
  for(const key of ['quality','thumbnail','external_url','import_origin']){
    if(key in result&&(typeof result[key]!=='string'||result[key].length>1000))throw new Error('invalid track');
  }
  if('duration'in result&&(!Number.isFinite(result.duration)||result.duration<0||result.duration>86400))throw new Error('invalid duration');
  if('is_preview'in result&&typeof result.is_preview!=='boolean')throw new Error('invalid preview flag');
  if('catalog_links'in result){
    const links=result.catalog_links;
    if(!links||typeof links!=='object'||Array.isArray(links)||Object.keys(links).length>10||Object.entries(links).some(([key,value])=>key.length>40||typeof value!=='string'||value.length>1000))throw new Error('invalid links');
  }
  return result;
}
function portableCopy(copy){
  if(!Array.isArray(copy?.library)||copy.library.length>1500||!Array.isArray(copy.playlists)||copy.playlists.length>25)throw new Error('invalid library');
  return{
    library:copy.library.map(portableTrack),
    playlists:copy.playlists.map(list=>{
      if(!list||typeof list.id!=='string'||!list.id||list.id.length>100||typeof list.name!=='string'||!list.name||list.name.length>60||!Array.isArray(list.items)||list.items.length>1000||!Array.isArray(list.importKeys??[])||(list.importKeys??[]).length>1000||(list.importKeys??[]).some(key=>typeof key!=='string'||key.length>500))throw new Error('invalid playlist');
      return{id:list.id,name:list.name,items:list.items.map(item=>{
        if(!item||!Number.isInteger(item.position)||item.position<0||item.position>=100000)throw new Error('invalid order');
        return{position:item.position,track:portableTrack(item.track)};
      }),importKeys:list.importKeys??[]};
    })
  };
}
function portableStatus(key){portableStatusKey=key;ui.portableStatus.textContent=key?t(key):''}
function renderPortablePreview(){
  if(!portablePending)return;
  const protectedCloud=Boolean(accountUser||readStoredText(accountOwnerKey,''));
  ui.portableReplace.hidden=protectedCloud;
  ui.portablePreviewText.textContent=t(protectedCloud?'portablePreviewAccount':'portablePreview',{tracks:portablePending.library.length,playlists:portablePending.playlists.length});
}
function dismissPortablePreview(){portablePending=null;ui.portablePreview.hidden=true;ui.portableFile.value=''}
ui.portableExport.addEventListener('click',()=>{
  if(accountChoice){portableStatus('portableBusy');return}
  try{
    const content=JSON.stringify({app:'SONGVALE',kind:'library',version:1,...portableCopy(accountCopy())},null,2);
    const blob=new Blob([content],{type:'application/json;charset=utf-8'});
    if(blob.size>4*1024*1024)throw new Error('library too large');
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`SONGVALE-library-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    portableStatus('portableExported');
  }catch{portableStatus('portableInvalid')}
});
ui.portableImport.addEventListener('click',()=>{
  if(accountChoice||accountBusy||importController){portableStatus('portableBusy');return}
  ui.portableFile.click();
});
ui.portableFile.addEventListener('change',async()=>{
  const file=ui.portableFile.files?.[0];if(!file)return;
  try{
    if(file.size>4*1024*1024)throw new Error('library too large');
    const parsed=JSON.parse(await file.text());
    if(parsed.app!=='SONGVALE'||parsed.kind!=='library'||parsed.version!==1)throw new Error('invalid library file');
    portablePending=portableCopy(parsed);
    renderPortablePreview();
    ui.portablePreview.hidden=false;portableStatus('');
  }catch{dismissPortablePreview();portableStatus('portableInvalid')}
});
async function acceptPortableCopy(merge){
  if(!portablePending)return;
  if(accountChoice||accountBusy||importController){portableStatus('portableBusy');return}
  if(!merge&&(accountUser||readStoredText(accountOwnerKey,''))){portableStatus('portableReplaceProtected');return}
  try{
    const next=merge?mergeAccountCopies(accountCopy(),portablePending):portablePending;
    if(!applyAccountCopy(next)){portableStatus('portableStorageFailed');return}
    markAccountDirty();
    dismissPortablePreview();portableStatus('portableImported');
  }catch{portableStatus('portableInvalid')}
}
ui.portableMerge.addEventListener('click',()=>void acceptPortableCopy(true));
ui.portableReplace.addEventListener('click',()=>void acceptPortableCopy(false));
ui.portableCancel.addEventListener('click',()=>{dismissPortablePreview();portableStatus('')});
window.addEventListener('online',()=>{if(accountUser&&accountDirty)void syncAccount();else if(!accountUser&&(!accountAvailable||accountStatusKey==='accountOffline'))void initializeAccount()});
window.addEventListener('storage',event=>{
  if(event.key!==accountOwnerKey||!accountUser||event.newValue===accountUser.id)return;
  accountEpoch++;clearTimeout(accountTimer);accountUser=null;accountChoice=null;accountRevision=0;accountDirty=false;accountSyncedSignature='';accountBusy=false;
  ui.closePlayer.click();state.saved=[];state.playlists=[];state.activePlaylistId=null;state.queue=[];state.recents=[];
  ui.playlistTabs.dataset.rendered='';updateLibraryCount();render();accountStatus('accountGuestStatus');renderAccountStatus();
  if(event.newValue)void initializeAccount();
});
window.addEventListener('focus',()=>{
  if(accountUser&&!accountChoice&&!accountBusy&&Date.now()-lastAccountRefresh>60000)void syncAccount();
  else if(!accountUser&&accountStatusKey==='accountOffline')void initializeAccount();
});
function applyLanguage(){language=i18n.language;i18n.apply();applyVisual(false);applyRepeatMode(false);updateAudioEngineUi();syncVolumeButton();ui.playPause.setAttribute('aria-label',t(state.isPlaying?'pauseAria':'playAria'));render();renderDiagnostics();if(latestImportReport)updateImportReport(latestImportReport)}

function emitAwun(type,detail={}){document.dispatchEvent(new CustomEvent(`awun:${type}`,{detail}))}

const formatTime=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
const textDecoder=document.createElement('textarea');
const decodedTextCache=new Map();
const decodeText=value=>{
  const raw=String(value||'');if(!raw.includes('&'))return raw;
  if(decodedTextCache.has(raw))return decodedTextCache.get(raw);
  textDecoder.innerHTML=raw;const decoded=textDecoder.value;
  if(decodedTextCache.size>=512)decodedTextCache.clear();decodedTextCache.set(raw,decoded);return decoded;
};
const safeImage=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return''}};
const activePlaylist=()=>state.playlists.find(list=>list.id===state.activePlaylistId)||null;
const currentList=()=>{
  if(!state.library)return state.tracks;
  const playlist=activePlaylist();
  const tracks=state.activeSmartPlaylist?smartTracks(state.activeSmartPlaylist):playlist?playlist.items.map(item=>item.track):state.saved;
  const query=matchText(state.libraryQuery);
  return query?tracks.filter(track=>matchText(`${decodeText(track.artist)} ${decodeText(track.title)}`).includes(query)):tracks;
};
const selectedIds=()=>new Set(state.saved.map(track=>track.id));
const waveformKey=track=>[track?.source,track?.id,track?.artist,track?.title,track?.duration].filter(value=>value!==undefined&&value!==null).join('|')||'awun';
const waveformCacheKey='awun-waveforms-v1';
const waveformLoads=new Map();
const waveformTargets=new WeakMap();
let waveformObserver=null;
function loadWaveformCache(){
  const value=readStoredJson(waveformCacheKey,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}
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
  writeStoredJson(waveformCacheKey,waveformCache,{backup:false});
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

function updateLibraryCount(){
  ui.libraryButton.querySelector('b').textContent=String(state.saved.length).padStart(2,'0');
  if(ui.welcomeLibraryCount)ui.welcomeLibraryCount.textContent=t('tracksOnDevice',{count:state.saved.length});
  ui.welcomePanel?.classList.toggle('has-library',Boolean(state.saved.length));
}

const listeningKey='awun-listening-v1';
const smartTitles={recent:'smartRecent',frequent:'smartFrequent',forgotten:'smartForgotten'};
function listeningMetadata(){const value=readStoredJson(listeningKey,{});return value?.owner===(readStoredText(accountOwnerKey,'')||'guest')?smartPlaylists.sanitize(value.tracks):{}}
function saveListeningMetadata(tracks){return writeStoredJson(listeningKey,{version:1,owner:readStoredText(accountOwnerKey,'')||'guest',tracks})}
function noteLibraryAdditions(before,after){saveListeningMetadata(smartPlaylists.noteAdditions(before,after,listeningMetadata()))}
function smartTracks(preset){return smartPlaylists.select(preset,smartPlaylists.inventory(state.saved,state.playlists),listeningMetadata())}
function renderSmartPlaylists(){
  const tabs=$('smartPlaylistTabs');tabs.replaceChildren();
  smartPlaylists.presets.forEach(preset=>{const button=document.createElement('button');button.type='button';button.className='playlist-tab smart-playlist-tab';button.dataset.smartPlaylist=preset;button.textContent=`${t(smartTitles[preset])} · ${smartTracks(preset).length}`;button.setAttribute('aria-pressed',String(state.activeSmartPlaylist===preset));button.onclick=()=>{state.activeSmartPlaylist=preset;state.activePlaylistId=null;state.visibleTrackLimit=60;render();tabs.querySelector('[aria-pressed="true"]')?.focus()};tabs.append(button)});
  const hint=$('smartPlaylistHint');hint.hidden=!state.activeSmartPlaylist;if(state.activeSmartPlaylist)hint.textContent=t(`${smartTitles[state.activeSmartPlaylist]}Hint`);
}
function persistLibrary(){const before=smartPlaylists.inventory(loadLibrary(),state.playlists),saved=writeStoredJson('awun-library',state.saved);if(saved){noteLibraryAdditions(before,smartPlaylists.inventory(state.saved,state.playlists));updateLibraryCount();markAccountDirty()}return saved}
function storePlaylists(next){
  const before=smartPlaylists.inventory(state.saved,state.playlists);
  if(!writeStoredJson(playlistsKey,next)){setMessage(t('storageSaveFailed'),'error');return false}
  state.playlists=next;noteLibraryAdditions(before,smartPlaylists.inventory(state.saved,state.playlists));markAccountDirty();return true;
}
function createPlaylist(name,{activate=true,importKeys=[]}={}){
  const base=String(name||'').trim().slice(0,60);if(!base)return null;
  if(state.playlists.length>=25){setMessage(t('playlistLimit'),'error');return null}
  let title=base,suffix=2;
  while(state.playlists.some(list=>list.name.toLocaleLowerCase()===title.toLocaleLowerCase()))title=`${base.slice(0,54)} (${suffix++})`;
  const playlist={id:globalThis.crypto?.randomUUID?.()||`list_${Date.now()}_${Math.random().toString(36).slice(2)}`,name:title,items:[],importKeys};
  if(!storePlaylists([...state.playlists,playlist]))return null;
  if(activate){state.activeSmartPlaylist=null;state.activePlaylistId=playlist.id;state.libraryQuery='';ui.libraryFilter.value='';setLibraryView(true)}
  return playlist;
}
function playlistTrack(track){
  const keys=['source','id','title','artist','duration','quality','stream_url','stream_type','stream_expires_at','is_preview','download_url','thumbnail','external_url','catalog_links','import_origin','stream_resolved_at'];
  return Object.fromEntries(keys.filter(key=>track[key]!=null).map(key=>[key,track[key]]));
}
function updatePlaylist(id,mutate){
  const current=state.playlists.find(list=>list.id===id);if(!current)return false;
  const next=mutate(current);if(!next)return false;
  return storePlaylists(state.playlists.map(list=>list.id===id?next:list));
}
function togglePlaylistTrack(id,track){
  const playlist=state.playlists.find(list=>list.id===id);if(!playlist)return;
  const key=trackSessionKey(track),exists=playlist.items.some(item=>trackSessionKey(item.track)===key);
  if(!exists&&playlist.items.length>=1000){setMessage(t('playlistTrackLimit'),'error');return}
  const position=Math.max(playlist.importKeys?.length||0,...playlist.items.map(item=>item.position+1));
  if(!updatePlaylist(id,list=>({...list,items:exists?list.items.filter(item=>trackSessionKey(item.track)!==key):[...list.items,{track:playlistTrack(track),position}]})))return;
  setMessage(t(exists?'removedFromPlaylist':'addedToPlaylist',{name:playlist.name}),'notice');render();
}
function addImportedToPlaylist(id,entries){
  if(!id||!entries.length)return true;
  const current=state.playlists.find(list=>list.id===id);if(!current)return true;
  const items=[...current.items],keys=new Set(items.map(item=>trackSessionKey(item.track)));
  for(const {imported,match} of entries){
    const key=trackSessionKey(match);if(keys.has(key))continue;
    if(items.length>=1000)break;
    keys.add(key);
    const order=current.importKeys?.indexOf(importKey(imported.artist,imported.title))??-1;
    items.push({track:playlistTrack(match),position:order<0?(current.importKeys?.length||0)+items.length:order});
  }
  items.sort((a,b)=>a.position-b.position);
  return updatePlaylist(id,list=>({...list,items}));
}
function renderPlaylists(){
  ui.libraryWorkspace.hidden=!state.library;
  if(!state.library)return;
  renderSmartPlaylists();
  const selected=activePlaylist();
  const signature=JSON.stringify([language,selected?.id,state.activeSmartPlaylist,state.playlists.map(list=>[list.id,list.name,list.items.length])]);
  if(ui.playlistTabs.dataset.rendered!==signature){
    ui.playlistTabs.replaceChildren();
    const all=document.createElement('button');all.type='button';all.textContent=t('allSaved');all.className='playlist-tab';all.setAttribute('aria-pressed',String(!selected&&!state.activeSmartPlaylist));all.addEventListener('click',()=>{state.activeSmartPlaylist=null;state.activePlaylistId=null;state.visibleTrackLimit=60;render();ui.playlistTabs.querySelector('[aria-pressed="true"]')?.focus()});ui.playlistTabs.append(all);
    state.playlists.forEach(list=>{const button=document.createElement('button');button.type='button';button.className='playlist-tab';button.textContent=`${list.name} · ${list.items.length}`;button.setAttribute('aria-pressed',String(list.id===selected?.id));button.addEventListener('click',()=>{state.activeSmartPlaylist=null;state.activePlaylistId=list.id;state.visibleTrackLimit=60;render();ui.playlistTabs.querySelector('[aria-pressed="true"]')?.focus()});ui.playlistTabs.append(button)});
    ui.playlistTabs.dataset.rendered=signature;
  }
  ui.playlistActions.hidden=!selected;
  if(selected)ui.playlistDescription.textContent=t('playlistTrackCount',{count:selected.items.length});
  const empty=!currentList().length;ui.libraryEmptyState.hidden=!empty;
  if(empty)ui.libraryEmptyState.textContent=t(state.libraryQuery?'libraryNoMatches':state.activeSmartPlaylist?'smartEmpty':selected?'playlistEmpty':'libraryEmpty');
}
function persistRecents(){writeStoredJson('awun-recent',state.recents.slice(0,12))}

function persistQueue(){
  state.queue=playerCore.uniqueTracks(state.queue);
  writeStoredJson('awun-queue-v1',{version:1,mode:state.queueMode,items:state.queue});
  renderSidebarListening();
  homeHub?.render();
}

function setMessage(text='',kind=''){
  ui.message.textContent=text;
  ui.message.className=`message ${kind}`.trim();
}
function setPlaybackStatus(message='',kind='loading'){
  ui.playerStatus.textContent=message;ui.playerStatus.hidden=!message;
  ui.playerStatus.dataset.tone=message?kind:'';
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
  themeChoiceButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===state.theme)));
  if(save)writeStoredJson('awun-visual',{theme:state.theme,motion:state.motion,decor:state.decor,density:state.density});
}
function persistAudioPreferences(){writeStoredJson('songvale-audio-v1',{profile:state.audioProfile,enabled:state.audioProcessing})}
function updateAudioEngineUi(){
  audioProfileButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.audioProfile===state.audioProfile)));
  ui.soundEngineToggle.setAttribute('aria-pressed',String(state.audioProcessing));
  ui.soundEngineValue.textContent=t(state.audioProcessing?'on':'off');
  const status=!state.audioProcessing?'soundEngineDirectOnly':state.active?.source==='youtube'?'soundEngineYoutube':state.audioEngine?.available?'soundEngineActive':state.active?'soundEngineUnavailable':'soundEngineDirectOnly';
  ui.soundEngineStatus.textContent=t(status);
}
async function ensureAudioEngine(){
  if(!window.SongvaleAudioEngine?.Engine)return false;
  if(!state.audioEngine)state.audioEngine=new window.SongvaleAudioEngine.Engine(ui.audio,{profile:state.audioProfile,enabled:state.audioProcessing});
  const available=await state.audioEngine.connect();
  state.audioEngine.applyProfile(state.audioProfile);state.audioEngine.setEnabled(state.audioProcessing);
  updateAudioEngineUi();return available;
}

function openThemePanel(){setQueueOpen(false);setPlayerExpanded(false);if(document.body.classList.contains('flow-screen-open'))document.getElementById('flowClose')?.click();ui.importPanel.hidden=true;ui.importBackdrop.hidden=true;ui.importButton.setAttribute('aria-expanded','false');ui.diagnosticsPanel.hidden=true;ui.diagnosticsButton.setAttribute('aria-expanded','false');ui.themePanel.hidden=false;ui.themeBackdrop.hidden=false;ui.themeButton.setAttribute('aria-expanded','true');document.body.classList.add('visual-open')}
function closeThemePanel(){document.body.classList.remove('visual-open');ui.themeButton.setAttribute('aria-expanded','false');ui.diagnosticsButton.setAttribute('aria-expanded','false');ui.themePanel.hidden=true;ui.diagnosticsPanel.hidden=true;ui.themeBackdrop.hidden=true}
function openDiagnosticsPanel(){setQueueOpen(false);setPlayerExpanded(false);ui.themePanel.hidden=true;ui.themeButton.setAttribute('aria-expanded','false');ui.diagnosticsPanel.hidden=false;ui.diagnosticsButton.setAttribute('aria-expanded','true');ui.themeBackdrop.hidden=false;renderDiagnostics();document.body.classList.add('visual-open');void refreshStatus()}
function openImportPanel(){setQueueOpen(false);setPlayerExpanded(false);ui.themePanel.hidden=true;ui.diagnosticsPanel.hidden=true;ui.themeBackdrop.hidden=true;ui.themeButton.setAttribute('aria-expanded','false');ui.importPanel.hidden=false;ui.importBackdrop.hidden=false;ui.importButton.setAttribute('aria-expanded','true');document.body.classList.add('visual-open');if(latestImportReport)updateImportReport(latestImportReport);requestAnimationFrame(()=>ui.importUrl?.focus({preventScroll:true}))}
function closeImportPanel(){document.body.classList.remove('visual-open');ui.importButton.setAttribute('aria-expanded','false');ui.importPanel.hidden=true;ui.importBackdrop.hidden=true}
function setQueueOpen(open){
  const next=Boolean(open);ui.player.classList.toggle('queue-open',next);document.body.classList.toggle('queue-open',next);ui.queueToggle?.setAttribute('aria-expanded',String(next));
  if(next)renderQueue();
}
function setPlayerExpanded(open){
  const next=Boolean(open);if(next)setQueueOpen(false);ui.player.classList.toggle('expanded-player',next);document.body.classList.toggle('player-expanded',next);ui.expandPlayer?.setAttribute('aria-expanded',String(next));
}
function yandexCatalogLink(artist,title){return `https://music.yandex.ru/search?text=${encodeURIComponent(`${artist||''} ${title||''}`.trim())}`}
function importKey(artist,title){return `${String(artist||'').trim().toLocaleLowerCase()}\u0000${String(title||'').trim().toLocaleLowerCase()}`}
function importIdentity(track){
  const normalize=window.SongvaleLibraryMatcher?.normalize||matchText;
  return `${normalize(track?.artist==='Yandex Music'?'':track?.artist)}\u0000${normalize(track?.title)}`;
}
function uniqueImportedTracks(tracks){
  const unique=new Map();for(const track of tracks){const key=importIdentity(track);if(!unique.has(key))unique.set(key,track)}return [...unique.values()];
}
function uniqueImportReview(review){
  const seen=new Set();return (review||[]).filter(item=>{const key=importIdentity(item.imported);if(seen.has(key))return false;seen.add(key);return true});
}
function importId(artist,title){let hash=2166136261;for(const character of importKey(artist,title)){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619)}return `ym_${(hash>>>0).toString(36)}`}
function splitImportedName(value){
  const clean=String(value||'').replace(/^\s*\d+[.)]\s*/,'').trim();
  const parts=clean.split(/\s+(?:—|–|-|\|)\s+|\t+/);
  if(parts.length<2)return{artist:'',title:clean};
  return{artist:parts.shift().trim(),title:parts.join(' — ').trim()};
}
function importedTrack(artist,title,duration=0){
  artist=String(artist||'').trim();title=String(title||'').trim();
  if(!title)return null;
  return{id:importId(artist,title),title,artist:artist||'Yandex Music',duration:Math.max(0,Math.round(Number(duration)||0)),quality:'YM',source:'yandex_music',stream_url:'',download_url:null,thumbnail:null,import_origin:'yandex_music',catalog_links:{yandex_music:yandexCatalogLink(artist,title)}};
}
function importDurationSeconds(value){
  if(Number.isFinite(Number(value))&&Number(value)>0)return Number(value)>10000?Math.round(Number(value)/1000):Math.round(Number(value));
  const parts=String(value||'').trim().split(':').map(Number);if(parts.some(part=>!Number.isFinite(part)))return 0;
  return parts.reduce((total,part)=>total*60+part,0);
}
function parseDelimitedRows(raw,delimiter){
  const rows=[];let values=[],current='',quoted=false;
  const finish=()=>{values.push(current.trim());if(values.some(Boolean))rows.push(values);values=[];current=''};
  for(let index=0;index<raw.length;index+=1){const character=raw[index];if(character==='"'){if(quoted&&raw[index+1]==='"'){current+='"';index+=1}else quoted=!quoted}else if(character===delimiter&&!quoted){values.push(current.trim());current=''}else if((character==='\n'||character==='\r')&&!quoted){if(character==='\r'&&raw[index+1]==='\n')index+=1;finish()}else current+=character}
  if(current||values.length)finish();return rows;
}
function parseJsonLibrary(raw){
  const payload=JSON.parse(raw);const entries=Array.isArray(payload)?payload:payload.tracks||payload.items||payload.playlist?.tracks||payload.result?.tracks||[];
  if(!Array.isArray(entries))return[];
  return entries.map(entry=>{const item=entry?.track||entry||{};const title=item.title||item.name||item.track||item.trackName||'';let artist=item.artist||item.artist_name||item.artistName||'';if(Array.isArray(item.artists))artist=item.artists.map(value=>typeof value==='string'?value:value?.name).filter(Boolean).join(', ');else if(artist&&typeof artist==='object')artist=artist.name||'';return importedTrack(artist,title,importDurationSeconds(item.duration||item.duration_ms||item.length))}).filter(Boolean);
}
function parseCsvLibrary(raw){
  const firstLine=raw.split(/\r?\n/,1)[0]||'';
  const delimiter=firstLine.includes('\t')?'\t':(firstLine.match(/;/g)||[]).length>(firstLine.match(/,/g)||[]).length?';':',';
  const rows=parseDelimitedRows(raw.replace(/^\uFEFF/,''),delimiter);if(!rows.length)return[];
  const headers=rows[0].map(value=>value.toLocaleLowerCase().replace(/[\s_-]/g,''));
  const titleIndex=headers.findIndex(value=>['title','track','tracktitle','name','song','название','трек','песня','названиетрека'].includes(value));
  const artistIndex=headers.findIndex(value=>['artist','artists','artistname','performer','author','исполнитель','исполнители','артист','автор'].includes(value));
  const durationIndex=headers.findIndex(value=>['duration','length','time','durationms','длительность','время'].includes(value));
  const hasHeader=titleIndex>=0||artistIndex>=0;const start=hasHeader?1:0;
  return rows.slice(start).map(values=>{const title=values[titleIndex>=0?titleIndex:0]||'';const artist=values[artistIndex>=0?artistIndex:1]||'';return importedTrack(artist,title,durationIndex>=0?importDurationSeconds(values[durationIndex]):0)}).filter(Boolean);
}
function parseM3uLibrary(raw){return raw.split(/\r?\n/).filter(line=>/^#EXTINF:/i.test(line)).map(line=>{const {artist,title}=splitImportedName(line.slice(line.indexOf(',')+1));const duration=importDurationSeconds(line.match(/^#EXTINF:([^,]+)/i)?.[1]);return importedTrack(artist,title,duration)}).filter(Boolean)}
function isImportDuration(value){return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)}
function cleanImportLine(value){return String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function importedTrackFromBlock(lines,duration=0){
  const clean=lines.map(cleanImportLine).filter(line=>line&&!line.startsWith('#')&&!isImportDuration(line));
  if(!clean.length)return null;
  if(clean.length===1){const {artist,title}=splitImportedName(clean[0]);return importedTrack(artist,title,duration)}
  const title=clean[0],artist=clean.slice(1).filter(value=>value!==title).join(', ');
  return importedTrack(artist,title,duration);
}
function parseTextLibrary(raw){
  const source=String(raw||'').replace(/\r/g,'');
  const lines=source.split('\n').map(cleanImportLine);
  const contentLines=lines.filter(line=>line&&!line.startsWith('#')&&!isImportDuration(line));
  const delimitedTracks=contentLines.map(splitImportedName);
  if(delimitedTracks.length&&delimitedTracks.every(track=>track.artist&&track.title))return delimitedTracks.map(({artist,title})=>importedTrack(artist,title)).filter(Boolean);
  const durationCount=lines.filter(isImportDuration).length;
  if(durationCount){
    const tracks=[];let block=[];
    lines.forEach(line=>{
      if(!line||line.startsWith('#'))return;
      if(isImportDuration(line)){const track=importedTrackFromBlock(block,importDurationSeconds(line));if(track)tracks.push(track);block=[];return}
      block.push(line);
    });
    const tail=importedTrackFromBlock(block);if(tail)tracks.push(tail);
    if(tracks.length)return tracks;
  }
  const paragraphTracks=source.split(/\n\s*\n+/).map(block=>importedTrackFromBlock(block.split('\n'))).filter(Boolean);
  if(paragraphTracks.some(track=>track.artist!=='Yandex Music'))return paragraphTracks;
  return contentLines.map(splitImportedName).map(({artist,title})=>importedTrack(artist,title)).filter(Boolean);
}
function parseImportedLibrary(raw,fileName=''){
  const extension=fileName.toLocaleLowerCase().split('.').pop();let tracks=[];
  if(extension==='json'||/^[\s\n]*[\[{]/.test(raw)){try{tracks=parseJsonLibrary(raw)}catch{if(extension==='json')throw new Error(t('jsonInvalid'))}}
  if(!tracks.length&&(extension==='m3u'||extension==='m3u8'||/#EXTINF:/i.test(raw)))tracks=parseM3uLibrary(raw);
  if(!tracks.length&&(extension==='csv'||/[;,\t]/.test(raw.split(/\r?\n/,1)[0]||'')&&/\b(?:artist|performer|title|track)\b|исполнитель|название/i.test(raw.split(/\r?\n/,1)[0]||'')))tracks=parseCsvLibrary(raw);
  if(!tracks.length)tracks=parseTextLibrary(raw);
  return uniqueImportedTracks(tracks);
}
function validateImportCapacity(tracks){if(tracks.length>importTrackLimit)throw new Error(t('tooManyTracks',{count:tracks.length,limit:importTrackLimit}));return tracks}
function validateLibraryCapacity(tracks){
  if(state.saved.length+tracks.length>1500)throw new Error(t('libraryCapacity',{saved:state.saved.length,limit:1500,remaining:Math.max(0,1500-state.saved.length)}));
  return tracks;
}

function updateImportReport(report){
  report={...report,review:uniqueImportReview(report.review)};
  latestImportReport=report;
  const missed=Array.isArray(report.missed)?report.missed.length:Number(report.missed)||0;
  const review=Array.isArray(report.review)?report.review.length:0,pending=Array.isArray(report.pendingTracks)?report.pendingTracks.length:0,failed=Array.isArray(report.failed)?report.failed.length:0;
  const total=Math.max(0,Number(report.total)||0),processed=Math.max(0,Number(report.processed)||0),added=Math.max(0,Number(report.added)||0);
  const percent=total?Math.min(100,Math.round((processed/total)*100)):0;
  ui.importTotal.textContent=String(total);ui.importProcessed.textContent=String(processed);ui.importAdded.textContent=String(added);ui.importReviewCount.textContent=String(review);ui.importMissed.textContent=String(missed);
  ui.importFailed.textContent=String(failed);
  ui.importProgress.max=Math.max(1,total);ui.importProgress.value=processed;ui.importPercent.textContent=`${percent}%`;
  const titleKey=report.running?(report.titleKey==='readingPlaylistTitle'?'readingPlaylistTitle':'transferInProgress'):pending?'transferStopped':failed?'transferIncomplete':report.titleKey||'readyForLibrary';
  ui.importReportTitle.textContent=t(titleKey,report.titleValues||{});
  if(report.statusKey)ui.importStatus.textContent=t(report.statusKey,report.statusValues||{});
  if(review&&!report.running)ui.importStatus.textContent=t('reviewQueueStatus',{count:review});
  if(failed&&!report.running)ui.importStatus.textContent=t('importSourceFailures',{count:failed,review});
  ui.importDownloadReport.hidden=Boolean(report.running)||processed===0;
  ui.importOpenLibrary.hidden=Boolean(report.running)||state.saved.length===0;
  ui.importResume.hidden=Boolean(report.running)||pending===0;
  ui.importRetryMissed.hidden=Boolean(report.running)||(missed+failed)===0;
  renderImportReview();
  writeStoredJson('songvale-import-session-v1',{...report,version:1,running:false,updatedAt:new Date().toISOString()});
}

function setImportRunning(running){
  document.body.classList.toggle('import-running',running);
  [ui.importSubmit,ui.importUrlSubmit,ui.importFileButton,ui.importText,ui.importUrl,ui.importPlaylistName].forEach(control=>{if(control)control.disabled=running});
  ui.importCancel.hidden=!running;
}

function prepareImportReport(total,statusKey='tracksReady'){
  updateImportReport({total,processed:0,added:0,review:[],missed:[],pendingTracks:[],pending:total,running:false,titleKey:'readyToTransfer',statusKey,statusValues:{count:total}});
}

function commitImportedMatches(tracks){
  const matchApi=window.SongvaleLibraryMatcher;
  const identity=track=>[matchApi?.cleanArtist(track?.artist)||String(track?.artist||'').toLocaleLowerCase(),matchApi?.cleanTitle(track?.title)||String(track?.title||'').toLocaleLowerCase()].join('\u0000');
  const existing=new Set(state.saved.map(trackSessionKey)),existingIdentities=new Set(state.saved.map(identity));
  const additions=[];
  tracks.forEach(track=>{const key=trackSessionKey(track),canonical=identity(track);if(existing.has(key)||existingIdentities.has(canonical))return;existing.add(key);existingIdentities.add(canonical);additions.push(track)});
  if(additions.length){
    if(state.saved.length+additions.length>1500)throw new Error(t('libraryCapacity',{saved:state.saved.length,limit:1500,remaining:Math.max(0,1500-state.saved.length)}));
    const previous=state.saved;state.saved=[...additions,...previous];
    if(!persistLibrary()){state.saved=previous;throw new Error(t('storageSaveFailed'))}
  }
  return additions.length;
}

function renderImportReview(){
  if(!ui.importReviewPanel)return;
  const review=latestImportReport?.review||[],item=review[0];ui.importReviewPanel.hidden=Boolean(latestImportReport?.running)||!item;ui.importReviewCandidates.replaceChildren();
  if(!item||latestImportReport?.running)return;
  const imported=item.imported||{};ui.importReviewTitle.textContent=decodeText(imported.title||t('manualReview'));ui.importReviewOriginal.textContent=[decodeText(imported.artist),decodeText(imported.title),imported.duration?formatTime(imported.duration):''].filter(Boolean).join(' · ');ui.importReviewPosition.textContent='1 / '+review.length;
  const key=importKey(imported.artist,imported.title);if(ui.importReviewSearchInput.dataset.trackKey!==key){ui.importReviewSearchInput.dataset.trackKey=key;ui.importReviewSearchInput.value=((imported.artist==='Yandex Music'?'':imported.artist)+' '+imported.title).trim()}
  (item.candidates||[]).forEach((result,index)=>{
    const candidate=result.candidate||result,row=document.createElement('li'),copy=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small'),choose=document.createElement('button');
    title.textContent=decodeText(candidate.artist)+' — '+decodeText(candidate.title);meta.textContent=t('reviewCandidateMeta',{source:sourceLabels[candidate.source]||candidate.source,duration:formatTime(candidate.duration),confidence:Math.round((Number(result.confidence)||0)*100)});choose.type='button';choose.textContent=t('chooseMatch');choose.addEventListener('click',()=>chooseImportCandidate(index,item));copy.append(title,meta);row.append(copy,choose);ui.importReviewCandidates.append(row);
  });
}

function chooseImportCandidate(index,expectedItem){
  if(latestImportReport?.running||latestImportReport?.review?.[0]!==expectedItem)return;
  const review=[...(latestImportReport?.review||[])],item=review.shift(),result=item?.candidates?.[index],candidate=result?.candidate||result;if(!item||!candidate)return;
  candidate.catalog_links={...candidate.catalog_links,...item.imported?.catalog_links};candidate.import_origin='library_transfer_manual';
  let inserted;
  try{inserted=commitImportedMatches([candidate]);if(!addImportedToPlaylist(latestImportReport.playlistId,[{imported:item.imported,match:candidate}]))throw new Error(t('storageSaveFailed'))}
  catch(error){ui.importStatus.textContent=error.message||t('storageSaveFailed');return}
  const added=(Number(latestImportReport.added)||0)+inserted;
  const remaining=review.filter(entry=>importIdentity(entry.imported)!==importIdentity(item.imported));
  updateImportReport({...latestImportReport,added,review:remaining,titleKey:'transferComplete',statusKey:remaining.length?'reviewQueueStatus':'importDone',statusValues:remaining.length?{count:remaining.length}:{added,missed:(latestImportReport.missed||[]).length}});
}

function skipImportReview(){
  if(latestImportReport?.running)return;
  const item=latestImportReport?.review?.[0];if(!item)return;
  const review=latestImportReport.review.filter(entry=>importIdentity(entry.imported)!==importIdentity(item.imported));
  const missed=[...(latestImportReport.missed||[]),{...item.imported,skip_reason:'manual'}];
  updateImportReport({...latestImportReport,review,missed,titleKey:'transferComplete',statusKey:review.length?'reviewQueueStatus':'importDone',statusValues:review.length?{count:review.length}:{added:latestImportReport.added||0,missed:missed.length}});
}

async function searchImportReview(){
  if(latestImportReport?.running)return;
  const item=latestImportReport?.review?.[0],query=ui.importReviewSearchInput.value.trim();if(!item||!query)return;
  if(!state.sources.size){ui.importStatus.textContent=t('noSourcesError');return}
  ui.importReviewSearchButton.disabled=true;
  try{
    const resolution=await searchImportedResolution(item.imported,null,18,[query]);
    if(latestImportReport?.running||latestImportReport?.review?.[0]!==item)return;
    const candidates=resolution.match?window.SongvaleLibraryMatcher?.reviewCandidates([resolution.match],item.imported,3)||[]:resolution.candidates;
    if(!candidates.length){ui.importStatus.textContent=Object.keys(resolution.sourceErrors||{}).length?t('importSourceFailures',{count:1,review:latestImportReport.review.length}):t('reviewSearchEmpty');return}
    const review=[...latestImportReport.review];review[0]={...item,candidates,query};updateImportReport({...latestImportReport,review});
  }catch(error){ui.importStatus.textContent=error.message||t('reviewSearchEmpty')}finally{ui.importReviewSearchButton.disabled=false}
}

function downloadImportReport(){
  if(!latestImportReport)return;
  const concise=track=>({artist:track.artist||'',title:track.title||'',duration:track.duration||0});
  const payload={app:'SONGVALE',version:staticAssetVersion||null,created_at:new Date().toISOString(),playlist:latestImportReport.playlistName||null,total:latestImportReport.total,processed:latestImportReport.processed,added:latestImportReport.added,stopped:Boolean(latestImportReport.stopped),needs_review:(latestImportReport.review||[]).map(item=>concise(item.imported||{})),not_found:(latestImportReport.missed||[]).map(concise),search_failed:(latestImportReport.failed||[]).map(item=>({...concise(item),source_errors:item.source_errors||{}})),pending:(latestImportReport.pendingTracks||[]).map(concise)};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`SONGVALE-import-${new Date().toISOString().slice(0,10)}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}

async function importLibrary(){
  try{
    const tracks=validateLibraryCapacity(validateImportCapacity(parseImportedLibrary(ui.importText.value,ui.libraryFile.files?.[0]?.name||'')));if(!tracks.length)throw new Error(t('noImportEntries'));
    prepareImportReport(tracks.length);
    const fileName=ui.libraryFile.files?.[0]?.name||'';
    await matchAndSaveImported(tracks,{playlistName:ui.importPlaylistName.value.trim()||fileName.replace(/\.[^.]+$/,'')||t('importedPlaylist')});
  }catch(error){ui.importStatus.textContent=error.message||t('importFailed')}
}

function setRange(range,value){
  const min=Number(range.min)||0,max=Number(range.max)||100;
  const percent=Math.max(0,Math.min(100,((Number(value)-min)/(max-min))*100));
  range.value=String(value);
  range.style.setProperty('--value',`${percent}%`);
  if(range.classList.contains('progress'))range.parentElement?.style.setProperty('--value',`${percent}%`);
}

function sourceButtons(){return sourceButtonElements}
function syncSourceSelection(){
  const healthKnown=state.diagnostics?.origin!=='unavailable'&&Boolean(state.diagnostics?.data?.sources);
  state.sources=new Set([...state.preferredSources].filter(source=>!healthKnown||state.available.has(source)));
  sourceButtons().forEach(button=>{
    const selected=state.sources.has(button.dataset.source);
    button.classList.toggle('on',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
  homeHub?.render();
}

function recordPlaybackHealth(source,{success,error=null,latencyMs=null}={}){
  if(!source)return;
  const now=new Date().toISOString(),entry=state.playbackHealth[source]||{samples:0,successes:0};entry.samples+=1;
  if(success){entry.successes+=1;entry.last_success_at=now;if(Number.isFinite(latencyMs))entry.last_latency_ms=Math.max(0,Math.round(latencyMs))}
  else{entry.last_error=String(error||t('playbackFailed')).slice(0,240);entry.last_error_at=now}
  state.playbackHealth[source]=entry;
}
function activePlaybackFailure(entry){return Boolean(entry?.last_error_at&&(!entry.last_success_at||entry.last_error_at>entry.last_success_at))}

const diagnosticSources=['soundcloud','youtube','audius','jamendo','internet_archive'];
function diagnosticOrigin(origin){return t({local:'diagnosticLocalApi',fallback:'diagnosticFallbackApi',configured:'diagnosticConfiguredApi',current:'diagnosticCurrentApi'}[origin]||'diagnosticUnknownApi')}
function diagnosticTime(value){
  if(!value)return t('diagnosticNever');
  const date=new Date(value);if(Number.isNaN(date.getTime()))return t('diagnosticNever');
  return new Intl.DateTimeFormat(language==='ru'?'ru-RU':'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'2-digit'}).format(date);
}
function renderDiagnostics(){
  if(!ui.diagnosticsList||ui.diagnosticsPanel?.hidden)return;
  const snapshot=state.diagnostics,data=snapshot?.data||{},health=data.source_health||{},available=new Set(data.sources||[]);
  ui.diagnosticsEndpoint.textContent=snapshot?`${diagnosticOrigin(snapshot.origin)} · ${snapshot.endpoint_latency_ms??'—'} ${t('millisecondsShort')}`:t('diagnosticChecking');
  ui.diagnosticsChecked.textContent=snapshot?.checked_at?diagnosticTime(snapshot.checked_at):t('diagnosticNever');
  ui.diagnosticsList.replaceChildren();
  diagnosticSources.forEach(source=>{
    const provider=data.providers?.[source]||{},sample=health[source]||{},playback=state.playbackHealth[source]||{},enabled=available.has(source)&&provider.enabled!==false;
    const status=snapshot?.error?'unavailable':activePlaybackFailure(playback)?'degraded':enabled?(sample.status||'unknown'):'disabled';
    const row=document.createElement('article');row.className=`diagnostic-source ${status}`;
    const head=document.createElement('div');const identity=document.createElement('div');const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');const name=document.createElement('strong');name.textContent=sourceLabels[source]||source;identity.append(dot,name);const badge=document.createElement('span');badge.textContent=t(`diagnosticStatus_${status}`);head.append(identity,badge);
    const metrics=document.createElement('dl');
    const fields=[
      [t('diagnosticLatency'),sample.samples?`${sample.average_latency_ms} ${t('millisecondsShort')}`:'—'],
      [t('diagnosticSuccess'),sample.samples?`${Math.round((Number(sample.success_rate)||0)*100)}%`:'—'],
      [t('diagnosticLastCheck'),diagnosticTime(sample.last_checked_at)]
    ];
    fields.forEach(([label,value])=>{const group=document.createElement('div');const term=document.createElement('dt');term.textContent=label;const detail=document.createElement('dd');detail.textContent=value;group.append(term,detail);metrics.append(group)});
    const latestError=activePlaybackFailure(playback)?playback.last_error:sample.last_error,latestErrorAt=activePlaybackFailure(playback)?playback.last_error_at:sample.last_error_at;
    const error=document.createElement('p');error.textContent=latestError?`${t('diagnosticLastError')} · ${diagnosticTime(latestErrorAt)}: ${String(latestError).slice(0,240)}`:t(status==='disabled'?'diagnosticDisabledHint':'diagnosticNoErrors');
    row.append(head,metrics,error);ui.diagnosticsList.append(row);
  });
}
function diagnosticsReport(){
  const snapshot=state.diagnostics,data=snapshot?.data||{},health=data.source_health||{};
  return JSON.stringify({
    app:'SONGVALE',version:data.version||'unknown',created_at:new Date().toISOString(),platform:runtimePlatform,
    api:{mode:snapshot?.origin||'unavailable',latency_ms:snapshot?.endpoint_latency_ms??null,error:snapshot?.error||null},
    ui_error:snapshot?.ui_error||null,
    storage:storage?.info?.()||null,
    recent_events:runtimeLog?.report?.(40)||[],
    sources:diagnosticSources.map(source=>({source,enabled:(data.sources||[]).includes(source),status:activePlaybackFailure(state.playbackHealth[source])?'degraded':health[source]?.status||'unknown',average_latency_ms:health[source]?.average_latency_ms??null,success_rate:health[source]?.success_rate??null,samples:health[source]?.samples??0,last_checked_at:health[source]?.last_checked_at||null,last_success_at:health[source]?.last_success_at||null,last_error_at:health[source]?.last_error_at||null,last_error:health[source]?.last_error||null,playback:state.playbackHealth[source]||null}))
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

function exportLocalData(){
  storage?.download?.(`SONGVALE-backup-${new Date().toISOString().slice(0,10)}.json`);ui.diagnosticsToolsStatus.textContent=t('dataExported');runtimeLog?.log?.('storage.exported');
}
async function importLocalData(){
  const file=ui.storageImportFile.files?.[0];if(!file)return;
  try{
    if(accountUser&&accountBusy){ui.diagnosticsToolsStatus.textContent=t('accountRestoreWait');return}
    if(file.size>4*1024*1024)throw new Error('backup too large');
    const raw=await file.text(),preview=storage.previewImport(raw);
    if(!window.confirm(t('confirmRestoreData',{library:preview.library_tracks,queue:preview.queue_tracks})))return;
    ui.storageImport.disabled=true;
    if(accountUser){
      if(!writeStoredText(backupRestoreKey,accountUser.id,{backup:false}))throw new Error('restore marker unavailable');
      clearTimeout(accountTimer);accountChoice='restore';accountStatus('accountRestoreChoice');renderAccountStatus();
    }
    await storage.importState(raw);ui.diagnosticsToolsStatus.textContent=t('dataRestored');runtimeLog?.log?.('storage.restored');setTimeout(()=>location.reload(),350);
  }catch(error){ui.diagnosticsToolsStatus.textContent=t('dataRestoreFailed');runtimeLog?.log?.('storage.restore-failed',{error:error?.message||error},'error')}
  finally{ui.storageImportFile.value='';ui.storageImport.disabled=false}
}
async function checkForUpdates(){
  if(!updateChecker?.check||ui.updateCheck.disabled)return;
  ui.updateCheck.disabled=true;
  ui.updateCheck.setAttribute('aria-busy','true');ui.updateLink.hidden=true;ui.diagnosticsToolsStatus.textContent=t('updateChecking');
  try{
    if(!state.diagnostics?.data?.version)await refreshStatus();
    const current=state.diagnostics?.data?.version||'0.0.0',result=await updateChecker.check(current);
    if(result.status==='available'){ui.diagnosticsToolsStatus.textContent=t('updateAvailable',{version:result.latest});ui.updateLink.href=result.url;ui.updateLink.hidden=false}
    else ui.diagnosticsToolsStatus.textContent=t(result.status==='no-release'?'updateNoRelease':'updateCurrent');
    runtimeLog?.log?.('update.checked',{current,status:result.status,latest:result.latest||null});
  }catch(error){ui.diagnosticsToolsStatus.textContent=t('updateFailed');runtimeLog?.log?.('update.failed',{error:error?.message||error},'warning')}
  finally{ui.updateCheck.removeAttribute('aria-busy');ui.updateCheck.disabled=false}
}

let healthRequest=null;
function refreshStatus(){
  if(!healthRequest)healthRequest=refreshStatusOnce().finally(()=>{healthRequest=null});
  return healthRequest;
}
async function refreshStatusOnce(){
  ui.diagnosticsRefresh?.setAttribute('aria-busy','true');
  let snapshot;
  try{
    snapshot=await requestHealthSnapshot();state.diagnostics=snapshot;runtimeLog?.log?.('health.available',{origin:snapshot.origin,latency_ms:snapshot.endpoint_latency_ms,sources:snapshot.data?.sources||[]});
  }catch(error){
    state.diagnostics={error:error?.message||t('healthFailed'),origin:'unavailable',endpoint_latency_ms:null,checked_at:new Date().toISOString(),data:{sources:[],source_health:{},providers:{}}};
    runtimeLog?.log?.('health.unavailable',{error:error?.message||error},'error');
    if(ui.searchMeta)ui.searchMeta.textContent=t('healthFailed');
    syncSourceSelection();
    sourceButtons().forEach(button=>{button.disabled=false;const hint=button.querySelector('small');if(hint)hint.textContent=t('sourceStatusUnknown')});
    ui.diagnosticsRefresh?.removeAttribute('aria-busy');renderDiagnostics();homeHub?.render();return;
  }
  try{
    const data=snapshot.data;
    state.available=new Set(data.sources||[]);
    state.geniusEnabled=Boolean(data.providers?.track_stories?.genius_annotations);
    syncSourceSelection();
    sourceButtons().forEach(button=>{
      const source=button.dataset.source;
      const available=state.available.has(source);
      button.disabled=!available;
      button.classList.toggle('on',available&&state.sources.has(source));
      const hint=button.querySelector('small');if(hint)hint.textContent=t(available?'active':'notConnected');
      button.title=t(available?'sourceAvailable':'sourceUnavailable',{source:sourceLabels[source]});
    });
    const names=[...state.available].map(source=>sourceLabels[source]||source);
    if(ui.searchMeta)ui.searchMeta.textContent=names.length?t(names.length===1?'sourceOnline':'sourcesOnline',{count:names.length}):t('localNoSources');
  }catch(error){
    state.diagnostics={...snapshot,ui_error:error?.message||'interface update failed'};
  }finally{ui.diagnosticsRefresh?.removeAttribute('aria-busy');renderDiagnostics();homeHub?.render()}
}

function loadingRows(){
  clearTrackRows();
  ui.homeSections.hidden=true;ui.results.hidden=false;
  ui.trackList.replaceChildren();
  for(let index=0;index<4;index+=1){
    const row=document.createElement('li');row.className='skeleton';
    for(let part=0;part<4;part+=1)row.append(document.createElement('i'));
    ui.trackList.append(row);
  }
}

function rememberRecent(track){
  state.recents=[track,...state.recents.filter(item=>item.id!==track.id)].slice(0,12);
  persistRecents();
  renderSidebarListening();
}

let sidebarSignature='';
function renderSidebarListening(){
  if(!ui.sidebarQueue||!ui.sidebarRecent)return;
  const signature=JSON.stringify([language,state.active?.id,state.queue.slice(0,3).map(track=>[track.id,track.title,track.artist,track.thumbnail]),state.recents.slice(0,3).map(track=>[track.id,track.title,track.artist,track.thumbnail])]);
  if(signature===sidebarSignature)return;
  sidebarSignature=signature;
  const fill=(container,tracks,emptyKey,play)=>{
    const nodes=tracks.slice(0,3).map((track,index)=>{
      const item=document.createElement('li');
      const button=document.createElement('button');button.type='button';button.className='sidebar-track';button.title=`${decodeText(track.title)} — ${decodeText(track.artist)}`;
      button.setAttribute('aria-label',t('playTrackAria',{title:decodeText(track.title)}));
      const cover=document.createElement('span');cover.className='sidebar-track-cover';
      const artwork=safeImage(track.thumbnail);if(artwork)cover.style.backgroundImage=`url("${artwork}")`;else cover.textContent=String(index+1).padStart(2,'0');
      const copy=document.createElement('span');copy.className='sidebar-track-copy';
      const title=document.createElement('strong');title.textContent=decodeText(track.title)||t('unknownTitle');
      const artist=document.createElement('small');artist.textContent=decodeText(track.artist)||t('unknownArtist');
      copy.append(title,artist);button.append(cover,copy);button.addEventListener('click',()=>void play(track));item.append(button);return item;
    });
    if(!nodes.length){const empty=document.createElement('li');empty.className='sidebar-list-empty';empty.textContent=t(emptyKey);nodes.push(empty)}
    container.replaceChildren(...nodes);
  };
  fill(ui.sidebarQueue,state.queue,'sidebarQueueEmpty',playQueuedTrack);
  fill(ui.sidebarRecent,state.recents,'sidebarRecentEmpty',playTrack);
  ui.sidebarQueueAll.hidden=!state.queue.length;
  ui.sidebarRecentAll.hidden=!state.recents.length;
}

function renderHome(){
  if(!homeHub)homeHub=window.songvaleHome.create({state,t,language:()=>language,decodeText,safeImage,formatTime,sourceLabels,actions:{
    playTrack,togglePlayback,toggleSave,replaceQueue,showLibrary:()=>setLibraryView(true),showPlaylist:id=>{state.activePlaylistId=id;setLibraryView(true)},showRecent:showRecentView,
    showQueue:()=>setQueueOpen(true),focusSearch,showWave:()=>$('flowButton').click(),
    showSources:()=>{const filters=document.querySelector('.advanced-search');filters.open=true;filters.querySelector('summary').focus();filters.scrollIntoView({block:'nearest'})},
    search:query=>{ui.searchInput.value=query;void search(query)}
  }});
  homeHub.render();
}

function focusSearch(){ui.searchInput.focus({preventScroll:true});ui.searchInput.scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'})}
function showRecentView(){setLibraryView(false);state.collection='recent';state.hasSearched=true;state.tracks=[...state.recents];render();ui.resultTitle.tabIndex=-1;ui.resultTitle.focus({preventScroll:true})}

function seedContextQueue(track){
  if(state.queueMode==='manual'&&state.queue.length)return;
  const list=currentList();const index=list.findIndex(item=>item.id===track.id);
  state.queue=index>=0?playerCore.uniqueTracks(list.slice(index+1)):[];
  state.queueMode='context';persistQueue();
}

function replaceQueue(tracks,mode='context',{includeActive=false}={}){
  state.queue=playerCore.uniqueTracks(tracks).filter(track=>includeActive||track.id!==state.active?.id);
  state.queueMode=mode==='manual'?'manual':'context';persistQueue();if(ui.player.classList.contains('queue-open'))renderQueue();
}

function appendQueue(tracks,mode=state.queueMode){
  state.queue=playerCore.uniqueTracks([...state.queue,...tracks]).filter(track=>track.id!==state.active?.id);
  state.queueMode=mode==='manual'?'manual':'context';persistQueue();if(ui.player.classList.contains('queue-open'))renderQueue();
}

function queueTrack(track,position){
  state.queue=playerCore.enqueue(state.queue,track,position);
  state.queueMode='manual';persistQueue();if(ui.player.classList.contains('queue-open'))renderQueue();
  setMessage(t(position==='next'?'queuedNext':'queuedEnd',{track:decodeText(track.title)}),'notice');
}

function removeQueuedTrack(trackId){
  state.queue=playerCore.remove(state.queue,trackId);state.queueMode='manual';persistQueue();if(ui.player.classList.contains('queue-open'))renderQueue();
}

function moveQueuedTrack(fromIndex,toIndex){
  const next=Math.max(0,Math.min(state.queue.length-1,toIndex));
  state.queue=playerCore.move(state.queue,fromIndex,next);state.queueMode='manual';persistQueue();if(ui.player.classList.contains('queue-open'))renderQueue();
}

async function playQueuedTrack(track){
  removeQueuedTrack(track.id);setQueueOpen(false);await playTrack(track,{preserveQueue:true});
}

function renderQueue(){
  if(!ui.queueList||!ui.queueEmpty)return;
  ui.queueList.replaceChildren();ui.queueEmpty.hidden=Boolean(state.queue.length);
  state.queue.forEach((track,index)=>{
    const item=document.createElement('li');item.className='queue-item';item.draggable=true;item.dataset.queueId=track.id;item.dataset.queueIndex=String(index);
    const grip=document.createElement('span');grip.className='queue-grip';grip.textContent='⋮⋮';grip.setAttribute('aria-hidden','true');
    const image=safeImage(track.thumbnail);const cover=document.createElement('span');cover.className='queue-cover';if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=decodeText(track.title||'AW').slice(0,2).toUpperCase();
    const button=document.createElement('button');button.type='button';button.className='queue-track';button.dataset.queueAction='play';const title=document.createElement('strong');title.textContent=decodeText(track.title)||t('unknownTitle');const artist=document.createElement('span');artist.textContent=decodeText(track.artist)||t('unknownArtist');button.append(title,artist);
    const duration=document.createElement('time');duration.textContent=formatTime(track.duration);
    const controls=document.createElement('div');controls.className='queue-controls';
    const up=document.createElement('button');up.type='button';up.dataset.queueAction='up';up.textContent='↑';up.disabled=index===0;up.setAttribute('aria-label',t('queueMoveUpAria',{track:decodeText(track.title)}));
    const down=document.createElement('button');down.type='button';down.dataset.queueAction='down';down.textContent='↓';down.disabled=index===state.queue.length-1;down.setAttribute('aria-label',t('queueMoveDownAria',{track:decodeText(track.title)}));
    const remove=document.createElement('button');remove.type='button';remove.dataset.queueAction='remove';remove.textContent='×';remove.setAttribute('aria-label',t('queueRemoveAria',{track:decodeText(track.title)}));controls.append(up,down,remove);
    item.append(grip,cover,button,duration,controls);ui.queueList.append(item);
  });
}

function render(){
  renderSidebarListening();
  renderPlaylists();
  ui.nowTitle.textContent=state.active?decodeText(state.active.title):t('nothingPlaying');
  ui.playPause.setAttribute('aria-label',t(state.isPlaying?'pauseAria':'playAria'));
  const list=currentList(),saved=selectedIds();
  const playerSaved=Boolean(state.active&&saved.has(state.active.id));
  ui.playerSave.disabled=!state.active;ui.playerSave.classList.toggle('saved',playerSaved);ui.playerSave.textContent=playerSaved?'♥':'♡';ui.playerSave.setAttribute('aria-pressed',String(playerSaved));ui.playerSave.setAttribute('aria-label',t(playerSaved?'removeLibraryAria':'addLibrary'));ui.playerSave.title=t(playerSaved?'removeLibraryAria':'addLibrary');
  const showHome=!state.library&&!state.hasSearched;
  ui.homeSections.hidden=!showHome;
  ui.results.hidden=showHome;
  if(showHome)renderHome();
  if(ui.player.classList.contains('queue-open'))renderQueue();
  ui.emptyGuide.hidden=Boolean(list.length)||state.library;
  ui.resultTitle.textContent=state.library?(state.activeSmartPlaylist?t(smartTitles[state.activeSmartPlaylist]):activePlaylist()?.name||t('yourLibrary')):t(state.collection==='recent'?'hubRecent':state.flow?.active?'wave':state.tracks.length?'searchResults':'discover');
  ui.resultCount.textContent=t(state.library?'savedCount':state.collection==='recent'?'hubHistoryCount':'foundCount',{count:list.length});

  const visible=list.slice(0,state.visibleTrackLimit||60);
  const keys=new Set(visible.map(track=>trackSessionKey(track)));
  for(const [key,entry] of trackRows){if(!keys.has(key)){disposeTrackRow(entry.row);trackRows.delete(key)}}
  let skeleton;while((skeleton=ui.trackList.querySelector(':scope > .skeleton')))skeleton.remove();
  visible.forEach((track,index)=>{
    const key=trackSessionKey(track);let entry=trackRows.get(key);
    if(!entry||entry.track!==track||entry.language!==language){
      const row=createTrackRow(track,index,saved);
      if(entry){entry.row.replaceWith(row);disposeTrackRow(entry.row)}
      entry={track,row,language};trackRows.set(key,entry);
    }
    const row=entry.row;
    updateTrackRow(row,track,saved);
    const before=ui.trackList.children[index];if(before!==row)ui.trackList.insertBefore(row,before||null);
  });
  const more=$('loadMoreTracks');
  if(more){more.hidden=visible.length>=list.length;more.textContent=t('loadMoreTracks',{count:Math.min(60,list.length-visible.length)})}
}

const trackRows=new Map();
function disposeTrackRow(row){
  if(row.view?.waveform)waveformObserver?.unobserve(row.view.waveform);
  row.remove();
}
function clearTrackRows(){for(const entry of trackRows.values())disposeTrackRow(entry.row);trackRows.clear()}
function updateTrackRow(row,track,saved=selectedIds()){
  const active=state.active?.id===track.id,playing=active&&document.body.classList.contains('is-playing');
  const pending=state.pendingTrackId===track.id;
  row.classList.toggle('active',active);row.classList.toggle('is-loading',pending);
  row.setAttribute('aria-busy',String(pending));
  const {play,save,story,waveform}=row.view;play.textContent=pending?'…':track.source==='yandex_music'?'↻':playing?'Ⅱ':'▶';
  play.setAttribute('aria-label',pending?t('loadingTrack'):playing?t('pauseAria'):t('playTrackAria',{title:decodeText(track.title)}));
  const isSaved=saved.has(track.id);save.classList.toggle('saved',isSaved);save.textContent=t(isSaved?'saved':'addLibrary');save.setAttribute('aria-pressed',String(isSaved));save.setAttribute('aria-label',t(isSaved?'removeLibraryAria':'addLibrary'));
  const expanded=state.expanded===track.id;row.classList.toggle('expanded',expanded);row.setAttribute('aria-expanded',String(expanded));
  story.textContent=t(expanded?'close':'story');story.setAttribute('aria-expanded',String(expanded));story.setAttribute('aria-label',t(expanded?'closeTrackStoryAria':'trackStoryAria',{title:decodeText(track.title)}));
  const panel=row.querySelector('.track-story');
  if(!expanded)panel?.remove();
  else{
    const details=state.details.get(track.id),signature=JSON.stringify([...state.openLines])+JSON.stringify(state.lineComments);
    if(!panel||row.storyDetails!==details||row.storySignature!==signature){panel?.remove();row.append(renderStory(track));row.storyDetails=details;row.storySignature=signature}
  }
  waveform.style.setProperty('--track-progress',`${active&&track.duration?Math.min(100,100*state.playbackPosition/track.duration):0}%`);
}
function createTrackRow(track,index,saved=selectedIds()){
    const needsMatch=track.source==='yandex_music';
    const row=document.createElement('li');row.className='track';row.dataset.source=track.source;row.dataset.trackId=track.id;row.style.setProperty('--i',index);
    const cover=document.createElement('div');cover.className='cover';const image=safeImage(track.thumbnail);if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=decodeText(track.title||'?').slice(0,2).toUpperCase();
    const activateTrack=()=>state.active?.id===track.id?togglePlayback():playTrack(track);
    const play=document.createElement('button');play.className='play';play.type='button';play.textContent=needsMatch?'↻':state.active?.id===track.id?'Ⅱ':'▶';play.setAttribute('aria-label',t(needsMatch?'matchAndPlayAria':'playTrackAria',{title:decodeText(track.title)}));play.onclick=event=>{event.stopPropagation();activateTrack()};
    const name=document.createElement('button');name.className='name';name.type='button';name.setAttribute('aria-label',t('playTrackAria',{title:decodeText(track.title)}));const title=document.createElement('strong');title.textContent=decodeText(track.title)||t('unknownTitle');const artist=document.createElement('span');artist.textContent=decodeText(track.artist)||t('unknownArtist');name.append(title,artist);name.onclick=event=>{event.stopPropagation();activateTrack()};
    const waveform=document.createElement('button');waveform.className='track-waveform';waveform.type='button';waveform.setAttribute('aria-label',t('seekTrackAria',{title:decodeText(track.title)}));waveform.title=t('seekTrackHint');applyWaveform(waveform,track,74);
    waveform.onclick=event=>{
      event.stopPropagation();
      if(!event.detail||!track.duration){activateTrack();return}
      const bounds=waveform.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),position=ratio*track.duration;
      if(state.active?.id===track.id)seekTo(position,true);else void playTrack(track,{resumeAt:position});
    };
    waveform.onkeydown=event=>{
      if(state.active?.id!==track.id||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const position=event.key==='Home'?0:event.key==='End'?track.duration:state.playbackPosition+(event.key==='ArrowRight'?5:-5);seekTo(Math.max(0,Math.min(track.duration,position)),true);
    };
    const source=document.createElement('span');source.className=`tag ${track.source}`;source.textContent=sourceLabels[track.source]||track.source;
    const quality=document.createElement('span');quality.className='quality';quality.textContent=track.is_preview?t('previewLabel'):track.quality||'—';
    const duration=document.createElement('span');duration.className='duration';duration.textContent=formatTime(track.duration);
    const actions=document.createElement('div');actions.className='actions';
    const story=document.createElement('button');story.className='story-button';story.type='button';story.textContent=t(state.expanded===track.id?'close':'story');story.setAttribute('aria-expanded',String(state.expanded===track.id));story.onclick=event=>{event.stopPropagation();toggleStory(track)};actions.append(story);
    const save=document.createElement('button');save.className=`save ${saved.has(track.id)?'saved':''}`;save.type='button';save.textContent=t(saved.has(track.id)?'saved':'addLibrary');save.onclick=event=>{event.stopPropagation();toggleSave(track)};actions.append(save);
    const queueMenu=document.createElement('details');queueMenu.className='track-queue-menu';const queueSummary=document.createElement('summary');queueSummary.textContent=t('queue');queueSummary.setAttribute('aria-label',t('queueActionsAria',{track:decodeText(track.title)}));const queueOptions=document.createElement('div');const playNext=document.createElement('button');playNext.type='button';playNext.textContent=t('playNext');playNext.onclick=event=>{event.stopPropagation();queueTrack(track,'next');queueMenu.open=false};const addQueue=document.createElement('button');addQueue.type='button';addQueue.textContent=t('addToQueue');addQueue.onclick=event=>{event.stopPropagation();queueTrack(track,'end');queueMenu.open=false};queueOptions.append(playNext,addQueue);queueMenu.append(queueSummary,queueOptions);queueMenu.addEventListener('toggle',()=>{row.classList.toggle('queue-menu-open',queueMenu.open);if(!queueMenu.open){queueMenu.classList.remove('opens-up');return}queueOptions.querySelectorAll('.playlist-option,.playlist-option-label').forEach(node=>node.remove());if(state.playlists.length){const label=document.createElement('span');label.className='playlist-option-label';label.textContent=t('playlistMenuTitle');queueOptions.append(label);state.playlists.forEach(list=>{const option=document.createElement('button');option.className='playlist-option';option.type='button';const included=list.items.some(item=>trackSessionKey(item.track)===trackSessionKey(track));option.textContent=`${included?'✓ ':''}${list.name}`;option.setAttribute('aria-label',t(included?'removeFromPlaylistAria':'addToPlaylistAria',{name:list.name,track:decodeText(track.title)}));option.onclick=event=>{event.stopPropagation();queueMenu.open=false;togglePlaylistTrack(list.id,track)};queueOptions.append(option)})}document.querySelectorAll('.track-queue-menu[open]').forEach(menu=>{if(menu!==queueMenu)menu.open=false});requestAnimationFrame(()=>{const boundary=ui.results.getBoundingClientRect(),options=queueOptions.getBoundingClientRect();queueMenu.classList.toggle('opens-up',options.bottom>boundary.bottom-8)})});actions.append(queueMenu);
    if(track.download_url&&!playStoreMode){const download=document.createElement('a');download.className='download';download.href=track.download_url;download.download='';download.rel='noopener';download.textContent=t('download');download.onclick=event=>event.stopPropagation();actions.append(download)}
    const catalog=document.createElement('div');catalog.className='catalog-links';
    [['spotify','SPOTIFY'],['apple_music','APPLE'],['yandex_music','YANDEX']].forEach(([provider,label])=>{const href=safeImage(track.catalog_links?.[provider]);if(!href)return;const link=document.createElement('a');link.className='catalog-link';link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${label} ↗`;link.setAttribute('aria-label',t('findCatalogAria',{title:decodeText(track.title),source:label}));catalog.append(link)});
    if(catalog.childElementCount)actions.append(catalog);
    row.addEventListener('click',event=>{if(!event.target.closest('button,a,input,textarea,select,details,summary'))activateTrack()});
    row.append(cover,play,name,waveform,source,quality,duration,actions);row.view={play,save,story,waveform};
    return row;
}

function commentKey(track,line){return `${track.id}\u0000${line.index}\u0000${matchText(line.text).slice(0,80)}`}
function persistLineComments(){writeStoredJson('awun-line-comments-v1',state.lineComments)}
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
  if(state.saved.length>=1500&&!state.saved.some(item=>trackSessionKey(item)===trackSessionKey(track))){setMessage(t('libraryCapacity',{saved:state.saved.length,limit:1500,remaining:0}),'error');return}
  const previous=state.saved;
  state.saved=[...previous];
  const index=state.saved.findIndex(item=>item.id===track.id);
  if(index>=0)state.saved.splice(index,1);else state.saved.unshift({...track,title:decodeText(track.title),artist:decodeText(track.artist)});
  if(!persistLibrary()){state.saved=previous;setMessage(t('storageSaveFailed'),'error');return}render();emitAwun('library',{track,saved:index<0});
}

function progressiveTracks(tracksBySource,sourceOrder,limit){
  return playerCore.interleaveTracks(tracksBySource,sourceOrder,limit);
}
function mergeProgressiveData(aggregate,data,source,sourceOrder,limit){
  aggregate.tracks_by_source[source]=playerCore.uniqueTracks([...(aggregate.tracks_by_source[source]||[]),...playableSearchTracks(data.tracks)]);
  const ranked=progressiveTracks(aggregate.tracks_by_source,sourceOrder,limit);
  const byKey=new Map(ranked.map(track=>[trackSessionKey(track),track]));
  aggregate.tracks=playerCore.uniqueTracks([...aggregate.tracks.map(track=>byKey.get(trackSessionKey(track))).filter(Boolean),...ranked]).slice(0,limit);
  aggregate.searched_sources=[...new Set([...aggregate.searched_sources,...(data.searched_sources||[]),source])];
  aggregate.query_variants=[...new Set([...aggregate.query_variants,...(data.query_variants||[])])];
  aggregate.elapsed_ms=Math.max(aggregate.elapsed_ms,Number(data.elapsed_ms)||0);
  if(data.errors?.[source])aggregate.errors[source]=data.errors[source];else delete aggregate.errors[source];
  return aggregate;
}

async function search(query=ui.searchInput.value.trim()){
  if(!query)return;
  state.collection='';homeHub?.rememberQuery(query);
  if(state.controller&&!state.controller.signal.aborted&&state.searchQuery===query&&state.searchConfig===`${[...state.sources]}|${state.region}|${state.resultLimit}`)return;
  emitAwun('search');
  state.searchQuery=query;state.searchConfig=`${[...state.sources]}|${state.region}|${state.resultLimit}`;state.visibleTrackLimit=60;
  runtimeLog?.log?.('search.started',{query_length:query.length,sources:[...state.sources],region:state.region});
  state.controller?.abort();state.controller=new AbortController();state.library=false;state.hasSearched=true;ui.libraryButton.classList.remove('active');ui.libraryButton.setAttribute('aria-pressed','false');
  ui.searchNavButton.classList.add('active');ui.searchNavButton.setAttribute('aria-pressed','true');
  state.tracks=[];
  ui.results.setAttribute('aria-busy','true');ui.emptyGuide.hidden=true;ui.searchButton.classList.add('searching');document.body.classList.add('is-searching');setMessage(t('searchingSources'),'loading');ui.resultTitle.textContent=t('searching');ui.resultCount.textContent='—';ui.resultTime.textContent=t('pleaseWait');
  $('cancelSearch').hidden=false;$('retrySearch').hidden=true;
  const started=performance.now(),controller=state.controller;
  let sources=[...state.sources],cacheId=searchCacheId(query,sources,state.region,state.resultLimit),cached=cachedSearch(cacheId);
  const showCached=()=>{state.tracks=[...cached.tracks];render();setMessage(t('cachedResultsRefreshing',{count:state.tracks.length}),'loading');ui.resultTime.textContent=t('cachedResults');runtimeLog?.log?.('search.cache-hit',{results:state.tracks.length})};
  if(cached)showCached();
  else loadingRows();
  if(controller.signal.aborted||state.controller!==controller)return;
  if(!sources.length){finishSearch(controller);render();setMessage(t('noSourcesError'),'error');$('retrySearch').hidden=false;return}
  const perSourceLimit=Math.min(state.resultLimit,Math.max(8,Math.ceil((state.resultLimit/sources.length)*1.6)));
  const aggregate=cached?{...cached,query,tracks:[...cached.tracks],tracks_by_source:Object.fromEntries(Object.entries(cached.tracks_by_source).map(([source,tracks])=>[source,[...tracks]])),errors:{...(cached.errors||{})}}:{query,tracks:[],tracks_by_source:{},total:0,searched_sources:[],region:state.region,query_variants:[],errors:{},elapsed_ms:0};
  let completed=0,renderFrame=null,firstResultMs=null;
  const revalidatedSources=new Set(),successfulSources=new Set();
  const applyResults=(final=false)=>{
    if(state.controller!==controller||controller.signal.aborted)return;
    aggregate.total=aggregate.tracks.length;state.tracks=aggregate.tracks;
    const failures=Object.keys(aggregate.errors).map(source=>sourceLabels[source]||source),pending=Math.max(0,sources.length-completed);
    if(!final&&pending){setMessage(t('progressiveResults',{count:state.tracks.length,pending}),'loading');ui.resultTime.textContent=t('progressiveSources',{done:completed,total:sources.length});}
    else if(state.tracks.length)setMessage(failures.length?t('partialResults',{sources:failures.join(', ')}):t('selectTrack'),failures.length?'notice':'');
    else setMessage(failures.length?t('noPlayableResults',{sources:failures.join(', ')}):t('nothingFound'),'error');
    if(final){const variants=Math.max(1,aggregate.query_variants.length||1),elapsed=Math.round(performance.now()-started);ui.resultTime.textContent=t('searchTiming',{ms:elapsed,variants});runtimeLog?.log?.('search.completed',{elapsed_ms:elapsed,results:state.tracks.length,failed_sources:failures})}
    if(state.tracks.length||final){
      if(final){if(renderFrame!==null)cancelAnimationFrame(renderFrame);renderFrame=null;render();$('retrySearch').hidden=!failures.length}
      else if(renderFrame===null)renderFrame=requestAnimationFrame(()=>{
        renderFrame=null;if(controller.signal.aborted||state.controller!==controller)return;
        render();
        if(firstResultMs===null&&state.tracks.length){firstResultMs=Math.round(performance.now()-started);runtimeLog?.log?.('search.first-results',{elapsed_ms:firstResultMs,results:state.tracks.length})}
      });
    }
  };
  try{
    const payload={query,limit:perSourceLimit,region:state.region,locale:navigator.language||null};
    await Promise.all(sources.map(async source=>{
      try{
        const {data,supplement}=await requestSearch({...payload,sources:[source]},{signal:controller.signal});
        if(controller.signal.aborted)return;
        if(!revalidatedSources.has(source)){aggregate.tracks_by_source[source]=[];revalidatedSources.add(source)}successfulSources.add(source);
        mergeProgressiveData(aggregate,data,source,sources,state.resultLimit);applyResults(false);
        if(supplement){const merged=await supplement;if(merged&&!controller.signal.aborted){mergeProgressiveData(aggregate,merged,source,sources,state.resultLimit);applyResults(false)}}
      }catch(error){if(error?.name!=='AbortError')aggregate.errors[source]=error?.message||t('searchFailed')}
      finally{completed+=1;if(!controller.signal.aborted)applyResults(false)}
    }));
    if(controller.signal.aborted)return;
    applyResults(true);
    if(successfulSources.size)rememberSearch(cacheId,aggregate);
    const params=new URLSearchParams(runtimeParams);params.set('q',query);if(state.region!=='AUTO')params.set('region',state.region);else params.delete('region');if(state.resultLimit!==60)params.set('limit',String(state.resultLimit));else params.delete('limit');history.replaceState(null,'',`${location.pathname}?${params}`);
  }catch(error){
    if(error.name==='AbortError')return;
    state.tracks=[];render();setMessage(error.message||t('searchUnavailable'),'error');ui.resultTime.textContent=t('failed');runtimeLog?.log?.('search.failed',{error:error?.message||error},'error');
  }finally{if(renderFrame!==null)cancelAnimationFrame(renderFrame);finishSearch(controller)}
}

function finishSearch(controller){
  if(state.controller!==controller)return;
  state.controller=null;ui.results.setAttribute('aria-busy','false');ui.searchButton.classList.remove('searching');document.body.classList.remove('is-searching');$('cancelSearch').hidden=true;
}
function cancelSearch(announce=false){
  const controller=state.controller;if(!controller)return;
  controller.abort();finishSearch(controller);
  if(announce){render();setMessage(t('searchCancelled'),'notice');$('retrySearch').hidden=false}
}

function youtubeId(track){
  return youtubeVideoId(track);
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

function ensureHlsApi(){
  if(window.Hls)return Promise.resolve(window.Hls);
  if(state.hlsApi)return state.hlsApi;
  state.hlsApi=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let settled=false;
    const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value)};
    const timer=setTimeout(()=>finish(reject,new Error(t('requestTimedOut'))),12000);
    script.src=staticAssetUrl('hls.light.min.js');script.async=true;
    script.onload=()=>window.Hls?finish(resolve,window.Hls):finish(reject,new Error(t('playbackFailed')));
    script.onerror=()=>finish(reject,new Error(t('playbackFailed')));
    document.head.append(script);
  }).catch(error=>{state.hlsApi=null;throw error});
  return state.hlsApi;
}

function stopYouTubeTicker(){clearInterval(state.youtubeTicker);state.youtubeTicker=null}
function startYouTubeTicker(){
  stopYouTubeTicker();
  state.youtubeTicker=setInterval(()=>{if(state.youtube?.getPlayerState?.()===window.YT?.PlayerState?.PLAYING)updateTimeline(state.youtube.getCurrentTime(),state.youtube.getDuration())},500);
}

function stopYouTube(){
  clearTimeout(state.youtubeStartTimer);state.youtubeStartTimer=null;
  stopYouTubeTicker();
  if(state.youtube){try{state.youtube.destroy()}catch{}state.youtube=null}
  ui.youtubePlayer.replaceChildren();ui.youtubeDock.hidden=true;
}

function stopHls(){
  if(state.hls){try{state.hls.destroy()}catch{}state.hls=null}
}

function syncTrackPlayback(){
  homeHub?.syncPlayback();
  for(const {row,track} of trackRows.values()){
    const pending=state.pendingTrackId===track.id,playing=state.active?.id===track.id&&document.body.classList.contains('is-playing');
    row.classList.toggle('is-loading',pending);row.setAttribute('aria-busy',String(pending));
    const button=row.view.play;button.textContent=pending?'…':playing?'Ⅱ':'▶';button.setAttribute('aria-label',pending?t('loadingTrack'):playing?t('pauseAria'):t('playTrackAria',{title:decodeText(track.title)}));
  }
}
function setPlaying(playing){
  const next=Boolean(playing);if(state.isPlaying===next)return;state.isPlaying=next;
  ui.playPause.querySelector('span').textContent=next?'Ⅱ':'▶';ui.playPause.setAttribute('aria-label',t(next?'pauseAria':'playAria'));document.body.classList.toggle('is-playing',next);ui.player.classList.toggle('is-playing',next);syncTrackPlayback();
}

let listeningSession={generation:-1,seconds:0,counted:false,at:performance.now()};
setInterval(()=>{
  const now=performance.now(),elapsed=Math.min(5,Math.max(0,(now-listeningSession.at)/1000));listeningSession.at=now;
  if(listeningSession.generation!==state.playbackGeneration)listeningSession={generation:state.playbackGeneration,seconds:0,counted:false,at:now};
  if(!state.active||!state.isPlaying||state.restoredPlayback)return;
  listeningSession.seconds+=elapsed;
  const duration=Number(state.active.duration)||60,threshold=Math.min(30,Math.max(1,duration/2));
  if(!listeningSession.counted&&listeningSession.seconds>=threshold){
    if(saveListeningMetadata(smartPlaylists.record(listeningMetadata(),state.active))){listeningSession.counted=true;if(state.library)render()}
  }
},1000);

function applyRepeatMode(save=true){
  const labels={off:'repeatOff',all:'repeatAll',one:'repeatOne'},descriptions={off:'repeatOffAria',all:'repeatAllAria',one:'repeatOneAria'};
  ui.repeatMode.querySelector('small').textContent=t(labels[state.repeatMode]);ui.repeatMode.setAttribute('aria-label',t(descriptions[state.repeatMode]));ui.repeatMode.setAttribute('aria-pressed',String(state.repeatMode!=='off'));ui.repeatMode.classList.toggle('active',state.repeatMode!=='off');ui.repeatMode.dataset.mode=state.repeatMode;
  if(save)writeStoredText('awun-repeat-mode',state.repeatMode);
}

function cycleRepeatMode(){const modes=['off','all','one'];state.repeatMode=modes[(modes.indexOf(state.repeatMode)+1)%modes.length];applyRepeatMode()}

function persistPlaybackSession(){
  if(!state.active)return false;
  const duration=state.active.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;
  return writeStoredJson(playbackSessionKey,{version:1,saved_at:Date.now(),track:state.active,position:currentPlaybackTime(),duration:Math.max(0,Number(duration)||Number(state.active.duration)||0)},{backup:false});
}
function clearPlaybackSession(){removeStored(playbackSessionKey);state.restoredPlayback=false;state.lastPlaybackPersistSecond=-1}

function presentPlayerTrack(track){
  ui.player.classList.remove('player-empty');ui.idleStage.setAttribute('aria-hidden','true');document.body.classList.add('has-player');ui.nowTitle.textContent=decodeText(track.title);ui.nowArtist.textContent=`${decodeText(track.artist)} · ${sourceLabels[track.source]||track.source}`;ui.nowSource.textContent=sourceLabels[track.source]||track.source;
  if(track.is_preview)ui.nowSource.textContent+=` · ${t('previewLabel')}`;
  const image=safeImage(track.thumbnail),monogram=ui.playerArtwork.querySelector('.vinyl-monogram');
  ui.playerArtwork.style.setProperty('--vinyl-cover',image?`url("${image}")`:'none');ui.playerArtwork.classList.toggle('has-artwork',Boolean(image));applyWaveform(ui.waveProgress,track,132);
  if(monogram)monogram.textContent=image?'':(decodeText(track.title)||'AW').slice(0,2).toUpperCase();
}

function restorePlaybackSession(){
  const session=loadPlaybackSession();if(!session)return false;
  const position=session.duration&&session.duration-session.position<=10?0:session.position;
  state.active=session.track;state.playbackOrigin=session.track;state.playbackPosition=position;state.restoredPlayback=true;state.timelineSecond=-1;presentPlayerTrack(session.track);updateTimeline(position,session.duration);updateMediaSession(session.track);setPlaying(false);render();setMessage(t('playbackSessionRestored'),'notice');return true;
}

function updateTimeline(current,duration){
  const percent=duration?Math.max(0,Math.min(100,(current/duration)*100)):0;
  state.playbackPosition=Math.max(0,Number(current)||0);
  if(!state.seeking)setRange(ui.progress,Math.round(percent*10));
  trackRows.get(trackSessionKey(state.active))?.row.view.waveform.style.setProperty('--track-progress',`${percent}%`);
  document.querySelector('.home-track-card.active .home-track-meter')?.style.setProperty('--track-progress',`${percent}%`);
  const second=Math.floor(state.playbackPosition);if(second!==state.timelineSecond){state.timelineSecond=second;ui.elapsed.textContent=formatTime(current);ui.totalTime.textContent=formatTime(duration);if(second%2===0)emitAwun('progress',{track:state.active,current:state.playbackPosition,duration:Math.max(0,Number(duration)||0)});if(second%5===0&&second!==state.lastPlaybackPersistSecond){state.lastPlaybackPersistSecond=second;persistPlaybackSession()}}
}

async function playYouTube(track,startAt=0){
  const expectedGeneration=state.playbackGeneration;
  state.audioTrackId=null;ui.audio.pause();ui.audio.removeAttribute('src');stopHls();stopYouTube();ui.youtubeDock.hidden=false;ui.youtubeDock.classList.remove('minimized');
  const YT=await ensureYouTubeApi(),videoId=youtubeId(track);if(!videoId)throw new Error(t('invalidYoutubeResult'));
  if(expectedGeneration!==state.playbackGeneration)throw new DOMException('Playback superseded','AbortError');
  const startedAt=performance.now();
  const target=document.createElement('div');ui.youtubePlayer.replaceChildren(target);
  await new Promise((resolve,reject)=>{
    let settled=false,successRecorded=false;
    const current=()=>expectedGeneration===state.playbackGeneration&&state.active?.id===track.id;
    const finish=(callback,value)=>{if(settled)return false;settled=true;callback(value);return true};
    const fail=code=>{
      if(!current()){finish(reject,new DOMException('Playback superseded','AbortError'));return}
      const suffix=code==='timeout'?'start timeout':`code ${code??'unknown'}`,error=new Error(`${t('youtubeEmbedError')} (${suffix})`);
      markYoutubeFailed(track,code);state.failedTrackIds.add(track.id);recordPlaybackHealth('youtube',{success:false,error:error.message});stopYouTube();setPlaying(false);
      if(!finish(reject,error))void recoverPlayback(error,expectedGeneration);
    };
    state.youtube=new YT.Player(target,{width:'100%',height:'100%',videoId,playerVars:{autoplay:1,controls:1,playsinline:1,rel:0,origin:location.origin},events:{
      onReady:event=>{if(!current()){try{event.target.destroy()}catch{}finish(reject,new DOMException('Playback superseded','AbortError'));return}event.target.setVolume(Number(ui.volume.value));if(startAt>0)event.target.seekTo(startAt,true);event.target.playVideo();state.youtubeStartTimer=setTimeout(()=>{if(state.youtube?.getPlayerState?.()!==YT.PlayerState.PLAYING)fail('timeout')},12000)},
      onStateChange:event=>{if(!current())return;if(event.data===YT.PlayerState.PLAYING){clearTimeout(state.youtubeStartTimer);state.youtubeStartTimer=null;startYouTubeTicker();clearYoutubeFailure(track);if(!successRecorded){successRecorded=true;recordPlaybackHealth('youtube',{success:true,latencyMs:performance.now()-startedAt})}setPlaying(true);finish(resolve)}else{stopYouTubeTicker();if(event.data===YT.PlayerState.PAUSED)setPlaying(false);if(event.data===YT.PlayerState.ENDED)handleTrackEnded()}},
      onError:event=>fail(event?.data)
    }});
  });
}

function applyAudioStart(startAt){
  if(!(startAt>0))return;
  const generation=state.playbackGeneration;
  const seek=()=>{if(generation!==state.playbackGeneration)return;try{ui.audio.currentTime=startAt}catch{}};
  if(ui.audio.readyState>=1)seek();else ui.audio.addEventListener('loadedmetadata',seek,{once:true});
}

async function playAudio(track,startAt=0){
  const generation=state.playbackGeneration,signal=state.playbackController?.signal;
  const current=()=>generation===state.playbackGeneration&&state.active?.id===track.id;
  stopYouTube();stopHls();state.audioTrackId=null;
  if(state.audioEngine?.available&&!ui.audio.paused)await state.audioEngine.fadeTo(0,.1);
  ui.audio.pause();ui.audio.removeAttribute('src');ui.audio.load();
  const processed=await ensureAudioEngine();ui.audio.volume=processed?1:Number(ui.volume.value)/100;
  state.audioEngine?.setOutputLevel(0);state.audioTrackId=track.id;
  const nativeHls=Boolean(ui.audio.canPlayType('application/vnd.apple.mpegurl'));
  const hlsStream=track.stream_type?track.stream_type==='hls':track.source==='soundcloud'||/\.m3u8(?:[?#]|$)/i.test(track.stream_url);
  // Chrome/Opera may report native HLS support without playing this stream.
  // Prefer the bundled player; retain native playback for devices without MSE.
  let Hls=null;
  if(hlsStream){try{Hls=await ensureHlsApi()}catch(error){if(!nativeHls)throw error}}
  if(!current()||signal?.aborted)throw new DOMException('Playback superseded','AbortError');
  if(Hls?.isSupported?.()){
    const hls=new Hls({enableWorker:true});state.hls=hls;
    await new Promise((resolve,reject)=>{
      let settled=false,timer=null;
      const abort=()=>{stopHls();finish(reject,new DOMException('Playback superseded','AbortError'))};
      const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);callback(value)};
      timer=setTimeout(()=>finish(reject,new Error(t('requestTimedOut'))),10000);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return}
      hls.on(Hls.Events.ERROR,(_event,data)=>{if(!data.fatal||!current())return;if(settled)recoverPlayback(new Error(t('playbackFailed')),generation);else finish(reject,new Error(t('playbackFailed')))});
      hls.on(Hls.Events.MANIFEST_PARSED,async()=>{
        if(!current()){abort();return}
        try{applyAudioStart(startAt);await ui.audio.play();if(!current()){abort();return}state.audioEngine?.fadeTo(Number(ui.volume.value)/100,.16);setPlaying(true);finish(resolve)}catch(error){finish(reject,error)}
      });
      hls.on(Hls.Events.MEDIA_ATTACHED,()=>hls.loadSource(track.stream_url));
      hls.attachMedia(ui.audio);
    });
    return;
  }
  if(hlsStream&&!nativeHls)throw new Error(t('playbackFailed'));
  ui.audio.src=track.stream_url;
  applyAudioStart(startAt);await ui.audio.play();state.audioEngine?.fadeTo(Number(ui.volume.value)/100,.16);setPlaying(true);
}

function updateMediaSession(track){
  if(!('mediaSession'in navigator)||!('MediaMetadata'in window))return;
  const artwork=safeImage(track.thumbnail);navigator.mediaSession.metadata=new MediaMetadata({title:decodeText(track.title),artist:decodeText(track.artist),album:`SONGVALE · ${sourceLabels[track.source]||track.source}`,artwork:artwork?[{src:artwork}]:[]});
  const actions={play:()=>state.restoredPlayback?togglePlayback():resumePlayback(),pause:()=>pausePlayback(),previoustrack:()=>previousTrack(),nexttrack:()=>nextTrack(),seekbackward:details=>seekRelative(-(details.seekOffset||10)),seekforward:details=>seekRelative(details.seekOffset||10)};
  Object.entries(actions).forEach(([action,handler])=>{try{navigator.mediaSession.setActionHandler(action,handler)}catch{}});
}

function matchText(value){return decodeText(value).toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function bestImportedMatch(candidates,imported){
  return window.SongvaleLibraryMatcher?.bestMatch(candidates,imported)?.candidate||null;
}
async function searchImportedResolution(track,signal,limit=14,overrideQueries=null){
  const sources=['youtube','audius','soundcloud','jamendo','internet_archive'].filter(source=>state.sources.has(source)),matcher=window.SongvaleLibraryMatcher;
  if(!sources.length)throw new Error(t('noSourcesError'));
  const fallbackQuery=((track.artist==='Yandex Music'?'':track.artist)+' '+track.title).trim();
  const queries=overrideQueries||matcher?.searchQueries(track)||[fallbackQuery],candidates=[],seen=new Set(),errors={};
  // Check providers independently. A slow source must not discard a completed
  // YouTube match, and the bounded import workers must not flood slow sources.
  for(const source of sources){
    for(const query of queries){
      if(signal?.aborted)throw new DOMException('Import matching aborted','AbortError');
      try{
        const {data}=await requestSearch({query,limit,sources:[source],region:state.region,locale:navigator.language||null},{signal,waitForFallback:true,timeoutMs:importSearchTimeoutMs});
        for(const candidate of data.tracks||[]){const key=trackSessionKey(candidate);if(candidate?.id&&!seen.has(key)){seen.add(key);candidates.push(candidate)}}
        const match=bestImportedMatch(candidates,track);if(match)return{match,candidates:[]};
        if(Object.keys(data.errors||{}).length){errors[source]=data.errors[source]||Object.values(data.errors).join('; ');break}
      }catch(error){
        if(signal?.aborted||error?.name==='AbortError')throw error;
        errors[source]=error.message||t('searchFailed');break;
      }
    }
  }
  return{match:null,candidates:matcher?.reviewCandidates(candidates,track,3)||[],sourceErrors:errors};
}
async function searchImportedMatch(track,signal,limit=14){return(await searchImportedResolution(track,signal,limit)).match}
async function matchImportedTrack(track,expectedGeneration=state.playbackGeneration,signal){
  setMessage(t('matchingTrack',{track:`${decodeText(track.artist)} — ${decodeText(track.title)}`}),'loading');
  try{
    const fresh=await searchImportedMatch(track,signal,16);
    if(signal?.aborted||expectedGeneration!==state.playbackGeneration)return;
    if(!fresh)throw new Error(t('noPlayableMatch'));fresh.catalog_links={...fresh.catalog_links,...track.catalog_links};fresh.import_origin='yandex_music';
    const savedIndex=state.saved.findIndex(item=>item.id===track.id);if(savedIndex>=0)state.saved[savedIndex]=fresh;persistLibrary();render();setMessage(t('matchedOn',{source:sourceLabels[fresh.source]||fresh.source}),'notice');await playTrack(fresh);
  }catch(error){if(signal?.aborted||expectedGeneration!==state.playbackGeneration)return;setPlaybackStatus(t('trackUnavailableStatus'),'error');setMessage(error.message||t('importedMatchFailed'),'error')}
}

function directImportedTrack(entry){
  if(entry.source!=='youtube'||!entry.external_id)return null;
  return{id:`yt_${entry.external_id}`,title:entry.title,artist:entry.artist||'YouTube',duration:0,quality:'VIDEO',source:'youtube',stream_url:entry.external_url||`https://www.youtube.com/watch?v=${entry.external_id}`,download_url:null,thumbnail:entry.thumbnail||null,score:82,catalog_links:{youtube:entry.external_url||`https://www.youtube.com/watch?v=${entry.external_id}`}};
}
async function findImportedResolution(track,signal){
  if(track.source==='youtube'&&track.external_id)return{match:directImportedTrack(track),candidates:[]};
  return searchImportedResolution(track,signal);
}
async function matchAndSaveImported(tracks,{playlistId=null,playlistName=''}={}){
  clearTimeout(importPreviewTimer);importPreviewTimer=null;
  if(!tracks.length)throw new Error(t('noTracksInLibrary'));
  if(!state.sources.size){ui.importStatus.textContent=t('noSourcesError');return}
  const queue=validateLibraryCapacity(validateImportCapacity(uniqueImportedTracks(tracks))),staged=[],completed=new Set();
  const previous=playlistId&&latestImportReport?.playlistId===playlistId?latestImportReport:null;
  const incoming=new Set(queue.map(importIdentity));
  const retain=entries=>uniqueImportedTracks(entries||[]).filter(track=>!incoming.has(importIdentity(track)));
  const missed=retain(previous?.missed),failed=retain(previous?.failed),carriedPending=retain(previous?.pendingTracks);
  const review=uniqueImportReview(previous?.review).filter(item=>!incoming.has(importIdentity(item.imported)));
  // Rechecking a processed failure replaces its result. Resuming an unfinished
  // track adds progress; neither operation may erase the other queues.
  const rechecked=new Set([...(previous?.missed||[]),...(previous?.failed||[]),...(previous?.review||[]).map(item=>item.imported)].map(importIdentity).filter(key=>incoming.has(key)));
  const baseProcessed=Math.max(0,(Number(previous?.processed)||0)-rechecked.size);
  const total=Math.max(Number(previous?.total)||0,baseProcessed+queue.length+carriedPending.length);
  let cursor=0,done=baseProcessed,added=Number(previous?.added)||0,found=added,storageFailure=false;
  let playlist=state.playlists.find(list=>list.id===playlistId);
  if(!playlist){playlist=createPlaylist(playlistName||t('importedPlaylist'),{activate:false,importKeys:queue.map(track=>importKey(track.artist,track.title))});if(!playlist)throw new Error(t(state.playlists.length>=25?'playlistLimit':'storageSaveFailed'))}
  playlistId=playlist.id;playlistName=playlist.name;
  const controller=new AbortController();importController?.abort();importController=controller;setImportRunning(true);
  updateImportReport({playlistId,playlistName,total,processed:done,added,review:[...review],missed:[...missed],failed:[...failed],pendingTracks:[...carriedPending,...queue],pending:carriedPending.length+queue.length,running:true,titleKey:'transferInProgress',statusKey:'matchingProgress',statusValues:{done,total,found}});
  const flush=()=>{if(!staged.length||storageFailure)return;try{added+=commitImportedMatches(staged.map(entry=>entry.match));if(!addImportedToPlaylist(playlistId,staged))throw new Error(t('storageSaveFailed'));staged.length=0}catch(error){storageFailure=true;controller.abort();ui.importStatus.textContent=error.message||t('storageSaveFailed')}};
  const pendingTracks=()=>[...carriedPending,...queue.filter(track=>!completed.has(importKey(track.artist,track.title)))];
  const refresh=()=>{const pending=pendingTracks();updateImportReport({playlistId,playlistName,total,processed:done,added,review:[...review],missed:[...missed],failed:[...failed],pendingTracks:pending,pending:pending.length,running:true,titleKey:'transferInProgress',statusKey:'matchingProgress',statusValues:{done,total,found}})};
  let lastRefresh=performance.now();
  const worker=async()=>{
    while(!controller.signal.aborted&&cursor<queue.length){
      const track=queue[cursor++];let processed=false;
      try{
        const resolution=await findImportedResolution(track,controller.signal);
        if(controller.signal.aborted)break;
        if(resolution.match){resolution.match.import_origin='library_transfer';staged.push({imported:track,match:resolution.match});found+=1}
        else if(resolution.candidates?.length)review.push({imported:track,candidates:resolution.candidates});
        else if(Object.keys(resolution.sourceErrors||{}).length)failed.push({...track,source_errors:resolution.sourceErrors});
        else missed.push(track);
        processed=true;
      }catch(error){
        if(controller.signal.aborted||error?.name==='AbortError')break;
        failed.push({...track,source_errors:{request:error.message||t('searchFailed')}});processed=true;
      }finally{
        if(processed){
          completed.add(importKey(track.artist,track.title));done+=1;
          if(done%12===0||performance.now()-lastRefresh>1000){
            // Persist matched tracks before recording them as completed in the
            // resumable session. Reloading must not lose staged matches.
            flush();refresh();lastRefresh=performance.now();
          }
        }
      }
    }
  };
  try{
    await Promise.all(Array.from({length:Math.min(3,queue.length)},worker));flush();
    if(storageFailure){staged.forEach(entry=>completed.delete(importKey(entry.imported.artist,entry.imported.title)));done=baseProcessed+completed.size}
    const pending=pendingTracks(),stopped=controller.signal.aborted||pending.length>0;state.library=state.saved.length>0||Boolean(activePlaylist());ui.libraryButton.classList.toggle('active',state.library);ui.libraryButton.setAttribute('aria-pressed',String(state.library));ui.searchNavButton.classList.toggle('active',!state.library);ui.searchNavButton.setAttribute('aria-pressed',String(!state.library));render();
    const report={playlistId,playlistName,total,processed:done,added,review,missed,failed,pendingTracks:pending,pending:pending.length,running:false,stopped,titleKey:stopped?'transferStopped':'transferComplete',statusKey:review.length?'reviewQueueStatus':stopped?'importStopped':'importDone',statusValues:review.length?{count:review.length}:{added,missed:missed.length,processed:done,total}};updateImportReport(report);setMessage(storageFailure?t('storageSaveFailed'):failed.length?t('importSourceFailures',{count:failed.length,review:review.length}):t(review.length?'reviewQueueStatus':stopped?'importStoppedSummary':'importSummary',review.length?{count:review.length}:{added,missed:missed.length,processed:done,total}),storageFailure?'error':'notice');if(storageFailure)ui.importStatus.textContent=t('storageSaveFailed');runtimeLog?.log?.('library.import',{total,processed:done,added,review:review.length,missed:missed.length,failed:failed.length,pending:pending.length,stopped});
  }finally{if(importController===controller)importController=null;setImportRunning(false)}
}
async function importLibraryUrl(){
  const url=ui.importUrl.value.trim();if(!url){ui.importStatus.textContent=t('pastePlaylistFirst');return}
  ui.importUrlSubmit.disabled=true;updateImportReport({total:0,processed:0,added:0,missed:[],running:true,titleKey:'readingPlaylistTitle',statusKey:'readingPlaylist'});
  try{const response=await awunFetch('/api/v1/library/import-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,max_tracks:500})});const data=await response.json();if(!response.ok)throw new Error(data.detail||t('playlistReadFailed'));prepareImportReport(data.tracks.length,'tracksRead');await matchAndSaveImported(data.tracks||[],{playlistName:ui.importPlaylistName.value.trim()||data.title||t('importedPlaylist')})}
  catch(error){updateImportReport({total:0,processed:0,added:0,missed:[],running:false,titleKey:'transferFailed',statusKey:'playlistImportFailed'});ui.importStatus.textContent=error.message||t('playlistImportFailed')}
  finally{ui.importUrlSubmit.disabled=false}
}

async function playTrack(track,options={}){
  runtimeLog?.log?.('playback.requested',{source:track.source,id:track.id,recovered:Boolean(options.recovered)});
  const preserveQueue=Boolean(options.preserveQueue),recovered=Boolean(options.recovered),resumeAt=Math.max(0,Number(options.resumeAt)||0);
  state.restoredPlayback=false;
  const playbackGeneration=recovered?(Number(options.playbackGeneration)||state.playbackGeneration):(state.playbackGeneration+=1);
  if(!recovered){state.playbackController?.abort();state.playbackController=new AbortController()}
  const signal=state.playbackController?.signal;
  state.pendingTrackId=track.id;syncTrackPlayback();
  const loadingText=t('trackLoadingStatus',{title:decodeText(track.title),source:sourceLabels[track.source]||track.source});
  setPlaybackStatus(loadingText);setMessage(loadingText,'loading');
  const requestedAt=performance.now();
  try{
  if(track.source==='yandex_music'){await matchImportedTrack(track,playbackGeneration,signal);return false}
  let refreshAttempted=false,refreshSucceeded=false;
  const sessionFresh=!recovered?freshTracksByKey.get(trackSessionKey(track)):null;
  if(sessionFresh&&(sessionFresh.stream_url!==track.stream_url||sessionFresh.is_preview!==track.is_preview))track=replaceStoredTrack(track,sessionFresh);
  if(!recovered&&options.refreshStored!==false&&shouldRefreshBeforePlayback(track)){
    refreshAttempted=true;state.sameSourceRefreshGeneration=playbackGeneration;setMessage(t('refreshingLink'),'loading');
    try{
      const refreshed=await refreshTrackLink(track,signal);
      if(playbackGeneration!==state.playbackGeneration)return false;
      if(refreshed){track=replaceStoredTrack(track,refreshed);refreshSucceeded=true;setMessage(t('linkRefreshed'),'notice')}
    }catch(error){if(error?.name==='AbortError')return false}
  }
  if(signal?.aborted||playbackGeneration!==state.playbackGeneration)return false;
  if(!preserveQueue)seedContextQueue(track);
  state.queue=playerCore.remove(state.queue,track.id);persistQueue();
  const firstReveal=!state.active,previous=state.active;state.active=track;
  updateAudioEngineUi();
  if(!recovered){state.playbackOrigin=track;state.failedSources.clear();state.failedTrackIds.clear();state.sameSourceRefreshGeneration=refreshAttempted?playbackGeneration:null}
  else state.playbackOrigin=options.origin||state.playbackOrigin||track;
  rememberRecent(track);presentPlayerTrack(track);ui.player.classList.remove('track-enter','track-swap');ui.player.classList.add(firstReveal?'track-enter':'track-swap');
  state.timelineSecond=-1;state.lastPlaybackPersistSecond=-1;updateTimeline(resumeAt,track.duration||0);updateMediaSession(track);render();emitAwun('play',{track,previous,recovered});
  try{
    if(track.source==='youtube')await playYouTube(track,resumeAt);else await playAudio(track,resumeAt);
    if(signal?.aborted||playbackGeneration!==state.playbackGeneration)return false;
    runtimeLog?.log?.('playback.started',{source:track.source,elapsed_ms:Math.round(performance.now()-requestedAt)});
    setPlaybackStatus(track.is_preview?t('previewPlaybackStatus'):undefined,track.is_preview?'notice':undefined);if(ui.message.textContent===loadingText)setMessage('');
    if(refreshAttempted&&!refreshSucceeded)setMessage('');
    return true;
  }catch(error){
    if(signal?.aborted||playbackGeneration!==state.playbackGeneration)return false;
    stopHls();setPlaying(false);
    runtimeLog?.log?.('playback.start-failed',{source:track.source,id:track.id,error:error?.message||error},'error');
    if(error?.name==='NotAllowedError'){setPlaybackStatus(t('playbackFailed'),'error');setMessage(t('playbackFailed'),'error');return false}
    if(error?.name==='AbortError'){setPlaybackStatus();return false}
    if(options.recoverOnFailure===false)return false;
    setPlaybackStatus(t('trackFindingAlternative'));
    queueMicrotask(()=>recoverPlayback(error,playbackGeneration));return false;
  }
  }finally{if(playbackGeneration===state.playbackGeneration){state.pendingTrackId=null;syncTrackPlayback()}}
}

function pausePlayback(){if(state.active?.source==='youtube'){try{state.youtube?.pauseVideo()}catch{}}else ui.audio.pause();setPlaying(false);persistPlaybackSession()}
function resumePlayback(){if(state.active?.source==='youtube'){try{state.youtube?.playVideo()}catch{}}else{const generation=state.playbackGeneration;setPlaybackStatus(t('trackLoadingStatus',{title:decodeText(state.active?.title),source:sourceLabels[state.active?.source]||state.active?.source||''}));ui.audio.play().then(()=>{if(generation!==state.playbackGeneration)return;setPlaying(true);setPlaybackStatus()}).catch(()=>{if(generation!==state.playbackGeneration)return;setPlaying(false);setPlaybackStatus(t('playbackFailed'),'error');setMessage(t('playbackFailed'),'error')})}}
function togglePlayback(){if(!state.active)return;if(ui.playerStatus.dataset.tone==='error'){void playTrack(state.active,{preserveQueue:true});return}if(state.restoredPlayback){void playTrack(state.active,{preserveQueue:true,resumeAt:state.playbackPosition});return}const playing=state.active.source==='youtube'?state.youtube?.getPlayerState?.()===1:!ui.audio.paused;playing?pausePlayback():resumePlayback()}

function adjacentTrack(direction){const list=currentList();if(!list.length)return null;const index=Math.max(0,list.findIndex(track=>track.id===state.active?.id));return list[(index+direction+list.length)%list.length]}
function previousTrack(){const track=adjacentTrack(-1);if(!track)return;if(state.active)state.queue=playerCore.enqueue(state.queue,state.active,'next');state.queueMode='manual';persistQueue();playTrack(track,{preserveQueue:true})}
function nextTrack(automatic=false){
  if(!state.queue.length&&state.repeatMode==='all'){
    state.queue=playerCore.uniqueTracks(currentList().filter(track=>track.id!==state.active?.id));state.queueMode='context';persistQueue();
  }
  const track=state.queue[0];if(!track)return false;
  state.queue=state.queue.slice(1);persistQueue();if(ui.player.classList.contains('queue-open'))renderQueue();if(!automatic)emitAwun('skip',{track:state.active,next:track});playTrack(track,{preserveQueue:true});return true;
}
function handleTrackEnded(){
  if(!state.active)return;
  if(state.repeatMode==='one'){seekTo(0,true);resumePlayback();return}
  emitAwun('complete',{track:state.active});
  if(nextTrack(true))return;
  setPlaying(false);const duration=state.active.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;updateTimeline(duration||state.active.duration||0,duration||state.active.duration||0);
  emitAwun('queue-ended',{track:state.active});
}
function seekRelative(offset){const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;const current=state.active?.source==='youtube'?state.youtube?.getCurrentTime?.():ui.audio.currentTime;seekTo(Math.max(0,Math.min(duration||0,(current||0)+offset)),true)}
function seekTo(seconds,allowSeek=true){if(!state.active)return;const duration=state.active.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;const position=Math.max(0,Math.min(duration||state.active.duration||0,seconds));if(state.active.source==='youtube'){try{state.youtube?.seekTo(position,allowSeek)}catch{}}else if(Number.isFinite(ui.audio.duration))ui.audio.currentTime=position;updateTimeline(position,duration||state.active.duration||0)}

function currentPlaybackTime(){
  const current=state.active?.source==='youtube'?state.youtube?.getCurrentTime?.():ui.audio.currentTime;
  return Math.max(0,Number(current)||0,state.playbackPosition||0);
}

function shouldRefreshBeforePlayback(track){
  return Boolean(track?.id&&playerCore.shouldRefreshStream(track));
}

async function refreshTrackLink(track,signal){
  if(!track?.id||!track.source||track.source==='yandex_music')return null;
  const query=`${decodeText(track.artist)} ${decodeText(track.title)}`.trim();
  if(!query)return null;
  const soundcloud=track.source==='soundcloud';
  const {data}=await requestSearch({query,limit:12,sources:[track.source],region:state.region,locale:navigator.language||null,fast:!soundcloud,refresh:true},{signal,waitForFallback:true,timeoutMs:soundcloud?importSearchTimeoutMs:undefined});
  const candidates=(data.tracks||[]).filter(candidate=>candidate.source===track.source);
  return candidates.find(candidate=>candidate.id===track.id)||playerCore.rankAlternatives(track,candidates,new Set())[0]||null;
}

function replaceStoredTrack(origin,replacement){
  const merged={...replacement,catalog_links:{...(origin.catalog_links||{}),...(replacement.catalog_links||{})}};
  const replace=items=>{const seen=new Set();return items.map(track=>track.id===origin.id?merged:track).filter(track=>{if(!track?.id||seen.has(track.id))return false;seen.add(track.id);return true})};
  state.saved=replace(state.saved);state.recents=replace(state.recents);state.queue=replace(state.queue);state.tracks=replace(state.tracks);
  const updatedPlaylists=state.playlists.map(list=>({...list,items:list.items.map(item=>trackSessionKey(item.track)===trackSessionKey(origin)?{...item,track:playlistTrack(merged)}:item)}));
  if(updatedPlaylists.some((list,index)=>list.items.some((item,position)=>item!==state.playlists[index].items[position])))storePlaylists(updatedPlaylists);
  freshTracksByKey.set(trackSessionKey(merged),merged);
  persistLibrary();persistRecents();persistQueue();
  return merged;
}

async function recoverPlayback(_error,expectedGeneration=state.playbackGeneration){
  if(!state.active||expectedGeneration!==state.playbackGeneration||state.recoveringGeneration===expectedGeneration)return false;
  const failed=state.active,origin=state.playbackOrigin||failed,resumeAt=currentPlaybackTime(),from=sourceLabels[failed.source]||failed.source;
  state.failedTrackIds.add(failed.id);runtimeLog?.log?.('playback.recovery-started',{source:failed.source,id:failed.id,error:_error?.message||_error},'warning');
  setPlaybackStatus(t('trackFindingAlternative'));
  state.recoveringGeneration=expectedGeneration;
  try{
    if(failed.source==='youtube'&&state.sameSourceRefreshGeneration!==expectedGeneration){
      state.sameSourceRefreshGeneration=expectedGeneration;setMessage(t('findingYoutubeAlternative'),'loading');
      let youtubeTracks=[];
      try{
        const {data}=await requestSearch({query:`${origin.artist} ${origin.title}`,limit:16,sources:['youtube'],region:state.region,locale:navigator.language||null},{waitForFallback:true});
        youtubeTracks=playerCore.rankAlternatives(origin,data.tracks||[],new Set()).filter(candidate=>!state.failedTrackIds.has(candidate.id)&&!youtubeRecentlyFailed(candidate));
      }catch{}
      for(const candidate of youtubeTracks){
        if(expectedGeneration!==state.playbackGeneration)return false;
        const started=await playTrack(candidate,{preserveQueue:true,recovered:true,resumeAt,origin,playbackGeneration:expectedGeneration,recoverOnFailure:false});
        if(started){replaceStoredTrack(origin,candidate);setMessage(t('youtubeAlternative'),'notice');runtimeLog?.log?.('playback.youtube-alternative',{from:failed.id,to:candidate.id});return true}
        state.failedTrackIds.add(candidate.id);
      }
    }else if(failed.source!=='youtube'&&state.sameSourceRefreshGeneration!==expectedGeneration){
      state.sameSourceRefreshGeneration=expectedGeneration;setMessage(t('refreshingLink'),'loading');
      let refreshed=null;
      try{refreshed=await refreshTrackLink(failed,state.playbackController?.signal)}catch{}
      if(expectedGeneration!==state.playbackGeneration)return false;
      if(refreshed){
        const started=await playTrack(refreshed,{preserveQueue:true,recovered:true,resumeAt,origin,playbackGeneration:expectedGeneration,recoverOnFailure:false});
        if(expectedGeneration!==state.playbackGeneration)return false;
        if(started){replaceStoredTrack(origin,refreshed);setMessage(t('linkRefreshed'),'notice');runtimeLog?.log?.('playback.link-refreshed',{source:failed.source,id:failed.id});return true}
      }
    }
    state.failedSources.add(failed.source);setMessage(t('findingAlternative',{source:from}),'loading');
    const sources=[...state.available].filter(source=>!state.failedSources.has(source)&&source!=='yandex_music');if(!sources.length)throw new Error();
    const {data}=await requestSearch({query:`${origin.artist} ${origin.title}`,limit:20,sources,region:state.region,locale:navigator.language||null},{waitForFallback:true});
    if(expectedGeneration!==state.playbackGeneration)return false;
    const alternatives=playerCore.rankAlternatives(origin,data.tracks||[],state.failedSources).filter(candidate=>!state.failedTrackIds.has(candidate.id)&&!youtubeRecentlyFailed(candidate));
    for(const candidate of alternatives){
      if(expectedGeneration!==state.playbackGeneration)return false;
      const started=await playTrack(candidate,{preserveQueue:true,recovered:true,resumeAt,origin,playbackGeneration:expectedGeneration,recoverOnFailure:false});
      if(expectedGeneration!==state.playbackGeneration)return false;
      if(started){replaceStoredTrack(origin,candidate);setMessage(t('sourceSwitched',{from,to:sourceLabels[candidate.source]||candidate.source}),'notice');runtimeLog?.log?.('playback.source-switched',{from:failed.source,to:candidate.source,id:candidate.id});return true}
      state.failedTrackIds.add(candidate.id);state.failedSources.add(candidate.source);
    }
    throw new Error();
  }catch{if(expectedGeneration!==state.playbackGeneration)return false;setPlaying(false);setPlaybackStatus(t(origin.is_preview?'previewUnavailableStatus':'trackUnavailableStatus'),'error');setMessage(t('allSourcesFailed'),'error');runtimeLog?.log?.('playback.recovery-failed',{source:failed.source,id:failed.id},'error');return false}
  finally{if(state.recoveringGeneration===expectedGeneration)state.recoveringGeneration=null}
}

sourceButtons().forEach(button=>button.addEventListener('click',()=>{
  const source=button.dataset.source;
  if(state.diagnostics?.origin!=='unavailable'&&state.diagnostics&&!state.available.has(source))return;
  if(state.preferredSources.has(source))state.preferredSources.delete(source);else state.preferredSources.add(source);
  writeStoredJson(sourceChoiceKey,[...state.preferredSources]);syncSourceSelection();
}));
ui.allSourcesButton?.addEventListener('click',()=>{
  state.preferredSources=new Set(!state.diagnostics||state.diagnostics.origin==='unavailable'?knownSearchSources:[...state.available]);
  writeStoredJson(sourceChoiceKey,[...state.preferredSources]);syncSourceSelection();
});
ui.regionSelect.addEventListener('change',()=>{state.region=regions.includes(ui.regionSelect.value)?ui.regionSelect.value:'AUTO';writeStoredText('awun-region',state.region)});
ui.limitSelect.addEventListener('change',()=>{const value=Number(ui.limitSelect.value);state.resultLimit=resultLimits.includes(value)?value:60;writeStoredText('awun-result-limit',String(state.resultLimit))});
ui.themeButton.addEventListener('click',()=>ui.themePanel.hidden?openThemePanel():closeThemePanel());ui.themeClose.addEventListener('click',closeThemePanel);ui.themeBackdrop.addEventListener('click',closeThemePanel);ui.diagnosticsButton.addEventListener('click',openDiagnosticsPanel);ui.diagnosticsClose.addEventListener('click',closeThemePanel);ui.diagnosticsRefresh.addEventListener('click',refreshStatus);ui.diagnosticsCopy.addEventListener('click',copyDiagnostics);document.getElementById('flowButton')?.addEventListener('click',()=>{setQueueOpen(false);setPlayerExpanded(false);if(!ui.themePanel.hidden||!ui.diagnosticsPanel.hidden)closeThemePanel()});
ui.diagnosticsLog.addEventListener('click',()=>runtimeLog?.download?.(`SONGVALE-log-${new Date().toISOString().slice(0,10)}.json`));ui.storageExport.addEventListener('click',exportLocalData);ui.storageImport.addEventListener('click',()=>ui.storageImportFile.click());ui.storageImportFile.addEventListener('change',importLocalData);ui.updateCheck.addEventListener('click',checkForUpdates);
ui.importButton.addEventListener('click',()=>ui.importPanel.hidden?openImportPanel():closeImportPanel());ui.importClose.addEventListener('click',closeImportPanel);ui.importBackdrop.addEventListener('click',closeImportPanel);ui.importFileButton.addEventListener('click',()=>ui.libraryFile.click());ui.importSubmit.addEventListener('click',importLibrary);ui.importUrlSubmit.addEventListener('click',importLibraryUrl);ui.importCancel.addEventListener('click',()=>importController?.abort());ui.importDownloadReport.addEventListener('click',downloadImportReport);ui.importOpenLibrary.addEventListener('click',()=>{const id=latestImportReport?.playlistId;state.activePlaylistId=state.playlists.some(list=>list.id===id)?id:null;closeImportPanel();setLibraryView(true)});
ui.importResume.addEventListener('click',()=>{const report=latestImportReport,tracks=report?.pendingTracks||[];if(tracks.length)void matchAndSaveImported(tracks,{playlistId:report.playlistId,playlistName:report.playlistName}).catch(error=>{ui.importStatus.textContent=error.message||t('importFailed')})});
ui.importRetryMissed.addEventListener('click',()=>{const report=latestImportReport,tracks=[...(report?.missed||[]),...(report?.failed||[])];if(tracks.length)void matchAndSaveImported(tracks,{playlistId:report.playlistId,playlistName:report.playlistName}).catch(error=>{ui.importStatus.textContent=error.message||t('importFailed')})});
ui.importReviewSkip.addEventListener('click',skipImportReview);ui.importReviewSearchButton.addEventListener('click',()=>void searchImportReview());ui.importReviewSearchInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void searchImportReview()}});
function previewImportedLibrary(fileName=''){
  try{
    const count=parseImportedLibrary(ui.importText.value,fileName).length;
    prepareImportReport(count,'uniqueTracksReady');
    if(count>importTrackLimit)ui.importStatus.textContent=t('tooManyTracks',{count,limit:importTrackLimit});
    else if(state.saved.length+count>1500)ui.importStatus.textContent=t('libraryCapacity',{saved:state.saved.length,limit:1500,remaining:Math.max(0,1500-state.saved.length)});
  }catch(error){ui.importStatus.textContent=error.message||t('fileReadFailed')}
}
ui.importText.addEventListener('input',()=>{clearTimeout(importPreviewTimer);importPreviewTimer=setTimeout(()=>{if(!importController)previewImportedLibrary(ui.libraryFile.files?.[0]?.name||'')},180)});
ui.libraryFile.addEventListener('change',async()=>{const file=ui.libraryFile.files?.[0];if(!file)return;if(file.size>2*1024*1024){ui.importStatus.textContent=t('fileTooLarge');return}try{ui.importText.value=await file.text();ui.importFileName.textContent=file.name;if(!ui.importPlaylistName.value.trim())ui.importPlaylistName.value=file.name.replace(/\.[^.]+$/,'').slice(0,60);previewImportedLibrary(file.name)}catch(error){ui.importStatus.textContent=error.message||t('fileReadFailed')}});
themeChoiceButtons.forEach(button=>button.addEventListener('click',()=>{state.theme=button.dataset.themeChoice;applyVisual()}));
audioProfileButtons.forEach(button=>button.addEventListener('click',()=>{state.audioProfile=button.dataset.audioProfile;state.audioEngine?.applyProfile(state.audioProfile);persistAudioPreferences();updateAudioEngineUi()}));
ui.soundEngineToggle.addEventListener('click',()=>{state.audioProcessing=!state.audioProcessing;state.audioEngine?.setEnabled(state.audioProcessing);persistAudioPreferences();updateAudioEngineUi()});
ui.sidebarQueueAll?.addEventListener('click',()=>setQueueOpen(true));
ui.sidebarRecentAll?.addEventListener('click',showRecentView);
ui.motionToggle.addEventListener('click',()=>{state.motion=state.motion==='on'?'off':'on';applyVisual()});ui.decorToggle.addEventListener('click',()=>{state.decor=state.decor==='full'?'minimal':'full';applyVisual()});ui.densityToggle.addEventListener('click',()=>{const modes=['compact','standard','airy'];state.density=modes[(modes.indexOf(state.density)+1)%modes.length];applyVisual()});
ui.searchForm.addEventListener('submit',event=>{event.preventDefault();search()});
ui.libraryFilter.addEventListener('input',()=>{state.libraryQuery=ui.libraryFilter.value;state.visibleTrackLimit=60;render()});
ui.playlistCreate.addEventListener('submit',event=>{event.preventDefault();if(createPlaylist(ui.playlistName.value)){ui.playlistName.value='';setMessage(t('playlistCreated'),'notice')}});
ui.deletePlaylist.addEventListener('click',()=>{const selected=activePlaylist();if(!selected||!confirm(t('deletePlaylistConfirm',{name:selected.name})))return;if(storePlaylists(state.playlists.filter(list=>list.id!==selected.id))){state.activePlaylistId=null;setMessage(t('playlistDeleted'),'notice');render()}});
$('cancelSearch').addEventListener('click',()=>cancelSearch(true));
$('retrySearch').addEventListener('click',()=>search(state.searchQuery||ui.searchInput.value.trim()));
$('loadMoreTracks').addEventListener('click',()=>{state.visibleTrackLimit=(state.visibleTrackLimit||60)+60;render()});

ui.languageButton.addEventListener('click',()=>i18n.setLanguage(language==='en'?'ru':'en'));document.querySelectorAll('[data-search-suggestion]').forEach(button=>button.addEventListener('click',()=>{ui.searchInput.value=button.dataset.searchSuggestion;search(button.dataset.searchSuggestion)}));ui.guideSearch.addEventListener('click',()=>ui.searchInput.focus());ui.guideWave.addEventListener('click',()=>document.getElementById('flowButton').click());ui.guideImport.addEventListener('click',()=>ui.importButton.click());ui.welcomeImport?.addEventListener('click',openImportPanel);ui.welcomeSearch?.addEventListener('click',()=>{ui.searchInput.focus({preventScroll:true});ui.searchInput.scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'})});ui.idleSearchButton?.addEventListener('click',()=>{ui.searchInput.focus({preventScroll:true});ui.searchInput.scrollIntoView({behavior:document.documentElement.dataset.motion==='off'?'auto':'smooth',block:'center'})});ui.idleWaveButton?.addEventListener('click',()=>document.getElementById('flowButton').click());
function showIOSInstallGuide(){
  const iphone=/iPhone|iPod/.test(navigator.userAgent);
  const installed=navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
  let dismissed=false;try{dismissed=sessionStorage.getItem('songvale-ios-install-dismissed-v1')==='yes'}catch{}
  ui.iosInstallGuide.hidden=!iphone||installed||dismissed;
}
ui.iosInstallDismiss.addEventListener('click',()=>{ui.iosInstallGuide.hidden=true;try{sessionStorage.setItem('songvale-ios-install-dismissed-v1','yes')}catch{}});
function setLibraryView(enabled){cancelSearch();const url=new URL(location.href);url.searchParams.delete('q');history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);document.getElementById('flowClose')?.click();state.collection='';state.visibleTrackLimit=60;setQueueOpen(false);setPlayerExpanded(false);if(!ui.themePanel.hidden||!ui.diagnosticsPanel.hidden)closeThemePanel();if(!ui.importPanel.hidden)closeImportPanel();state.library=enabled;state.hasSearched=enabled;ui.libraryButton.classList.toggle('active',enabled);ui.libraryButton.setAttribute('aria-pressed',String(enabled));ui.searchNavButton.classList.toggle('active',!enabled);ui.searchNavButton.setAttribute('aria-pressed',String(!enabled));setMessage(enabled?t(state.saved.length?'libraryStored':'libraryEmpty'):'');render()}
document.querySelector('.site-header .logo').addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();setLibraryView(false);ui.homeSections.scrollTop=0;$('hubTitle').focus({preventScroll:true});if(innerWidth<1100)window.scrollTo({top:0,behavior:'instant'})});
ui.libraryButton.addEventListener('click',()=>setLibraryView(!state.library));
ui.playPause.addEventListener('click',togglePlayback);ui.previousTrack.addEventListener('click',previousTrack);ui.nextTrack.addEventListener('click',nextTrack);ui.repeatMode.addEventListener('click',cycleRepeatMode);
ui.queueToggle?.addEventListener('click',()=>{if(state.active)setQueueOpen(!ui.player.classList.contains('queue-open'))});ui.queueClose?.addEventListener('click',()=>setQueueOpen(false));ui.expandPlayer?.addEventListener('click',()=>{if(state.active)setPlayerExpanded(true)});ui.collapsePlayer?.addEventListener('click',()=>setPlayerExpanded(false));
ui.playerSave?.addEventListener('click',()=>{if(state.active)toggleSave(state.active)});
ui.queueList?.addEventListener('click',event=>{
  const action=event.target.closest('[data-queue-action]')?.dataset.queueAction,item=event.target.closest('.queue-item');if(!action||!item)return;
  const index=Number(item.dataset.queueIndex),track=state.queue[index];if(!Number.isInteger(index)||!track)return;
  if(action==='play')void playQueuedTrack(track);else if(action==='up')moveQueuedTrack(index,index-1);else if(action==='down')moveQueuedTrack(index,index+1);else if(action==='remove')removeQueuedTrack(track.id);
});
ui.queueList?.addEventListener('dragstart',event=>{const item=event.target.closest('.queue-item');if(!item)return;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.dataset.queueIndex);item.classList.add('dragging')});
ui.queueList?.addEventListener('dragend',event=>event.target.closest('.queue-item')?.classList.remove('dragging'));
ui.queueList?.addEventListener('dragover',event=>{if(!event.target.closest('.queue-item'))return;event.preventDefault();event.dataTransfer.dropEffect='move'});
ui.queueList?.addEventListener('drop',event=>{const item=event.target.closest('.queue-item');if(!item)return;event.preventDefault();const from=Number(event.dataTransfer.getData('text/plain')),to=Number(item.dataset.queueIndex);if(Number.isInteger(from)&&Number.isInteger(to))moveQueuedTrack(from,to)});
ui.closePlayer.addEventListener('click',()=>{setQueueOpen(false);setPlayerExpanded(false);state.playbackGeneration+=1;state.playbackController?.abort();state.pendingTrackId=null;state.audioTrackId=null;pausePlayback();clearPlaybackSession();stopYouTube();stopHls();ui.audio.removeAttribute('src');ui.idleStage.setAttribute('aria-hidden','false');ui.player.classList.remove('track-enter','track-swap');ui.player.classList.add('player-empty');document.body.classList.remove('has-player');state.active=null;ui.nowTitle.textContent=t('nothingPlaying');ui.nowArtist.textContent='SONGVALE';ui.nowSource.textContent='—';setPlaybackStatus();render()});
ui.searchNavButton.addEventListener('click',()=>{setLibraryView(false);focusSearch()});
ui.clearQueue?.addEventListener('click',()=>{state.queue=[];state.queueMode='manual';persistQueue();renderQueue()});
ui.minimizeVideo.addEventListener('click',()=>{ui.youtubeDock.classList.toggle('minimized');ui.minimizeVideo.textContent=ui.youtubeDock.classList.contains('minimized')?'□':'—'});
ui.progress.addEventListener('change',()=>{state.seeking=false;const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;seekTo((Number(ui.progress.value)/1000)*(duration||0),true)});ui.progress.addEventListener('pointercancel',()=>{state.seeking=false});
ui.progress.addEventListener('pointerdown',()=>{state.seeking=true});ui.progress.addEventListener('pointerup',()=>{state.seeking=false;const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;seekTo((Number(ui.progress.value)/1000)*(duration||0),true)});ui.progress.addEventListener('input',()=>{setRange(ui.progress,ui.progress.value);const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;ui.elapsed.textContent=formatTime((Number(ui.progress.value)/1000)*(duration||0))});
function syncVolumeButton(){const muted=Number(ui.volume.value)===0,label=t(muted?'unmuteAria':'muteAria');ui.muteButton.setAttribute('aria-label',label);ui.muteButton.setAttribute('aria-pressed',String(muted));ui.muteButton.title=label}
ui.volume.addEventListener('input',()=>{setRange(ui.volume,ui.volume.value);const value=Number(ui.volume.value);if(value>0)state.lastVolume=value/100;if(state.audioEngine?.available){ui.audio.volume=1;state.audioEngine.setOutputLevel(value/100)}else ui.audio.volume=value/100;try{state.youtube?.setVolume(value)}catch{}syncVolumeButton()});
ui.muteButton.addEventListener('click',()=>{const muted=Number(ui.volume.value)===0;if(muted)setRange(ui.volume,Math.round(state.lastVolume*100)||82);else{state.lastVolume=Number(ui.volume.value)/100;setRange(ui.volume,0)}ui.volume.dispatchEvent(new Event('input'))});
ui.audio.addEventListener('timeupdate',()=>updateTimeline(ui.audio.currentTime,ui.audio.duration));ui.audio.addEventListener('loadedmetadata',()=>updateTimeline(ui.audio.currentTime,ui.audio.duration));ui.audio.addEventListener('play',()=>{setPlaying(true);startWaveformCapture(state.active)});ui.audio.addEventListener('pause',()=>{stopWaveformCapture();setPlaying(false)});ui.audio.addEventListener('ended',()=>{stopWaveformCapture();handleTrackEnded()});ui.audio.addEventListener('error',()=>{stopWaveformCapture();if(state.active?.id===state.audioTrackId)recoverPlayback()});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;ui.installButton.hidden=false});window.addEventListener('appinstalled',()=>{installPrompt=null;ui.installButton.hidden=true;setMessage(t('installed'),'notice')});ui.installButton.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;ui.installButton.hidden=true});
window.addEventListener('pagehide',persistPlaybackSession);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistPlaybackSession()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ui.player.classList.contains('queue-open')){setQueueOpen(false);return}if(event.key==='Escape'&&ui.player.classList.contains('expanded-player')){setPlayerExpanded(false);return}if(event.key==='Escape'&&!ui.importPanel.hidden){closeImportPanel();return}if(event.key==='Escape'&&(!ui.themePanel.hidden||!ui.diagnosticsPanel.hidden)){closeThemePanel();return}if(event.code==='Space'&&!['INPUT','TEXTAREA','BUTTON','SELECT','SUMMARY'].includes(document.activeElement?.tagName)&&state.active){event.preventDefault();togglePlayback()}});

async function bootstrap(){
  runtimeLog?.log?.('app.bootstrap',{platform:runtimePlatform,storage_schema:storage?.SCHEMA_VERSION||null});
  const url=runtimeParams,requestedRegion=url.get('region')?.toUpperCase(),requestedLimit=Number(url.get('limit'));if(regions.includes(requestedRegion)){state.region=requestedRegion;writeStoredText('awun-region',state.region)}if(resultLimits.includes(requestedLimit)){state.resultLimit=requestedLimit;writeStoredText('awun-result-limit',String(requestedLimit))}ui.regionSelect.value=state.region;ui.limitSelect.value=String(state.resultLimit);
  if(!playStoreMode&&'serviceWorker'in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});ui.player.hidden=false;ui.player.classList.add('player-empty');showIOSInstallGuide();updateLibraryCount();setRange(ui.volume,82);setRange(ui.progress,0);applyLanguage();restorePlaybackSession();syncSourceSelection();
  void initializeAccount();
  const status=refreshStatus();
  const query=url.get('q');if(query){ui.searchInput.value=query;void search(query)}
  void status.then(()=>runtimeLog?.log?.('app.ready',{sources:[...state.available]}));
}
window.awunApp={state,ui,playTrack,render,search,toggleSave,currentList,setMessage,sourceLabels,decodeText,matchText,loadingRows,awunFetch,requestSearch,pausePlayback,playStoreMode,apiBase,fallbackApiBase,apiUrl,refreshStatus,replaceQueue,appendQueue,cancelSearch,persistPlaybackSession};
window.songvaleApp=window.awunApp;
document.addEventListener('awun:language',event=>{language=event.detail.language;applyVisual(false);applyRepeatMode(false);syncVolumeButton();render();renderAccountStatus();portableStatus(portableStatusKey);if(portablePending)ui.portablePreviewText.textContent=t('portablePreview',{tracks:portablePending.library.length,playlists:portablePending.playlists.length});renderDiagnostics();if(latestImportReport)updateImportReport(latestImportReport);refreshStatus()});
bootstrap();
