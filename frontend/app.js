const sourceLabels={youtube:'YouTube',soundcloud:'SoundCloud',audius:'Audius',jamendo:'Jamendo',internet_archive:'Internet Archive',yandex_music:'Yandex Music'};
const regions=['AUTO','CIS','EUROPE','USA','LATAM','ASIA','GLOBAL'];
const resultLimits=[30,60,100];
const $=id=>document.getElementById(id);
const ui={
  status:$('status'),libraryButton:$('libraryButton'),searchForm:$('searchForm'),searchInput:$('searchInput'),searchButton:$('searchButton'),
  sources:$('sources'),regionSelect:$('regionSelect'),limitSelect:$('limitSelect'),results:$('results'),trackList:$('trackList'),message:$('message'),resultTitle:$('resultTitle'),resultCount:$('resultCount'),resultTime:$('resultTime'),searchMeta:$('searchMeta'),
  player:$('player'),playerArtwork:$('playerArtwork'),nowTitle:$('nowTitle'),nowArtist:$('nowArtist'),nowSource:$('nowSource'),audio:$('audio'),youtubeDock:$('youtubeDock'),youtubePlayer:$('youtubePlayer'),
  previousTrack:$('previousTrack'),playPause:$('playPause'),nextTrack:$('nextTrack'),progress:$('progress'),elapsed:$('elapsed'),totalTime:$('totalTime'),volume:$('volume'),muteButton:$('muteButton'),closePlayer:$('closePlayer'),minimizeVideo:$('minimizeVideo'),
  themeButton:$('themeButton'),themeLabel:$('themeLabel'),themePanel:$('themePanel'),themeClose:$('themeClose'),themeBackdrop:$('themeBackdrop'),themeColor:$('themeColor'),motionToggle:$('motionToggle'),motionValue:$('motionValue'),decorToggle:$('decorToggle'),decorValue:$('decorValue'),telemetryClock:$('telemetryClock'),
  importButton:$('importButton'),importPanel:$('importPanel'),importClose:$('importClose'),importBackdrop:$('importBackdrop'),libraryFile:$('libraryFile'),importFileButton:$('importFileButton'),importFileName:$('importFileName'),importText:$('importText'),importStatus:$('importStatus'),importSubmit:$('importSubmit')
};

function loadLibrary(){try{const value=JSON.parse(localStorage.getItem('awun-library')||'[]');return Array.isArray(value)?value:[]}catch{return[]}}
function loadRegion(){const value=localStorage.getItem('awun-region')||'AUTO';return regions.includes(value)?value:'AUTO'}
function loadResultLimit(){const value=Number(localStorage.getItem('awun-result-limit')||60);return resultLimits.includes(value)?value:60}
function loadVisual(){try{const value=JSON.parse(localStorage.getItem('awun-visual')||'{}');return{theme:['acid','ultraviolet','cobalt','ember'].includes(value.theme)?value.theme:'acid',motion:value.motion==='off'?'off':'on',decor:value.decor==='minimal'?'minimal':'full'}}catch{return{theme:'acid',motion:'on',decor:'full'}}}
const visualThemes={acid:{label:'ACID',color:'#10110e'},ultraviolet:{label:'ULTRAVIOLET',color:'#0d0718'},cobalt:{label:'COBALT',color:'#07111f'},ember:{label:'EMBER',color:'#160b07'}};
const state={
  tracks:[],saved:loadLibrary(),available:new Set(),sources:new Set(),region:loadRegion(),resultLimit:loadResultLimit(),library:false,active:null,controller:null,
  youtube:null,youtubeApi:null,youtubeTicker:null,seeking:false,recovering:false,lastVolume:.82,...loadVisual()
};

const formatTime=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
const decodeText=value=>{const node=document.createElement('textarea');node.innerHTML=String(value||'');return node.value};
const safeImage=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return''}};
const currentList=()=>state.library?state.saved:state.tracks;
const selectedIds=()=>new Set(state.saved.map(track=>track.id));

function persist(){
  localStorage.setItem('awun-library',JSON.stringify(state.saved));
  ui.libraryButton.querySelector('b').textContent=String(state.saved.length).padStart(2,'0');
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
  ui.themeLabel.textContent=theme.label;
  ui.themeColor.content=theme.color;
  ui.motionValue.textContent=state.motion.toUpperCase();
  ui.decorValue.textContent=state.decor.toUpperCase();
  document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===state.theme)));
  if(save)localStorage.setItem('awun-visual',JSON.stringify({theme:state.theme,motion:state.motion,decor:state.decor}));
}

function openThemePanel(){ui.importPanel.hidden=true;ui.importBackdrop.hidden=true;ui.importButton.setAttribute('aria-expanded','false');ui.themePanel.hidden=false;ui.themeBackdrop.hidden=false;ui.themeButton.setAttribute('aria-expanded','true');requestAnimationFrame(()=>document.body.classList.add('visual-open'))}
function closeThemePanel(){document.body.classList.remove('visual-open');ui.themeButton.setAttribute('aria-expanded','false');setTimeout(()=>{ui.themePanel.hidden=true;ui.themeBackdrop.hidden=true},180)}
function openImportPanel(){ui.themePanel.hidden=true;ui.themeBackdrop.hidden=true;ui.themeButton.setAttribute('aria-expanded','false');ui.importPanel.hidden=false;ui.importBackdrop.hidden=false;ui.importButton.setAttribute('aria-expanded','true');requestAnimationFrame(()=>document.body.classList.add('visual-open'))}
function closeImportPanel(){document.body.classList.remove('visual-open');ui.importButton.setAttribute('aria-expanded','false');setTimeout(()=>{ui.importPanel.hidden=true;ui.importBackdrop.hidden=true},180)}
function updateClock(){ui.telemetryClock.textContent=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Europe/Berlin'}).format(new Date())}

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
  if(extension==='json'||/^[\s\n]*[\[{]/.test(raw)){try{tracks=parseJsonLibrary(raw)}catch{if(extension==='json')throw new Error('The JSON file is not valid.')}}
  if(!tracks.length&&(extension==='m3u'||extension==='m3u8'||/#EXTINF:/i.test(raw)))tracks=parseM3uLibrary(raw);
  if(!tracks.length&&(extension==='csv'||/\b(?:artist|performer)[,;\t].*(?:title|track|name)/i.test(raw.split(/\r?\n/)[0]||'')))tracks=parseCsvLibrary(raw);
  if(!tracks.length)tracks=parseTextLibrary(raw);
  const unique=new Map();tracks.forEach(track=>unique.set(importKey(track.artist==='Yandex Music'?'':track.artist,track.title),track));return [...unique.values()].slice(0,1000);
}
function importLibrary(){
  try{
    const tracks=parseImportedLibrary(ui.importText.value,ui.libraryFile.files?.[0]?.name||'');if(!tracks.length)throw new Error('No “Artist — Track” entries were found.');
    const existing=new Set(state.saved.map(track=>importKey(track.artist,track.title)));const additions=tracks.filter(track=>!existing.has(importKey(track.artist,track.title)));
    state.saved=[...additions,...state.saved].slice(0,1500);persist();state.library=true;ui.libraryButton.classList.add('active');ui.libraryButton.setAttribute('aria-pressed','true');render();closeImportPanel();setMessage(`${additions.length} Yandex Music track${additions.length===1?'':'s'} imported. Press play to match each track across connected AWUN sources.`,'notice');
  }catch(error){ui.importStatus.textContent=error.message||'The library could not be imported.'}
}

function setRange(range,value){
  const min=Number(range.min)||0,max=Number(range.max)||100;
  const percent=Math.max(0,Math.min(100,((Number(value)-min)/(max-min))*100));
  range.value=String(value);
  range.style.setProperty('--value',`${percent}%`);
  if(range.classList.contains('progress'))range.parentElement?.style.setProperty('--value',`${percent}%`);
}

function sourceButtons(){return [...document.querySelectorAll('[data-source]')]}

async function refreshStatus(){
  try{
    const response=await fetch('/health',{cache:'no-store'});
    if(!response.ok)throw new Error('Health check failed');
    const data=await response.json();
    state.available=new Set(data.sources||[]);
    state.sources=new Set([...state.sources].filter(source=>state.available.has(source)));
    if(!state.sources.size)state.available.forEach(source=>state.sources.add(source));
    sourceButtons().forEach(button=>{
      const source=button.dataset.source;
      const available=state.available.has(source);
      button.disabled=!available;
      button.classList.toggle('on',available&&state.sources.has(source));
      button.querySelector('small').textContent=available?'ACTIVE':'NOT CONNECTED';
      button.title=available?`${sourceLabels[source]} is available`:`${sourceLabels[source]} is not configured`;
    });
    const names=[...state.available].map(source=>sourceLabels[source]||source);
    ui.status.className='status live';
    ui.status.querySelector('b').textContent=names.length?`LIVE · ${names.join(' / ').toUpperCase()}`:'LIVE · NO SOURCES';
    ui.searchMeta.textContent=names.length?`${names.length} SOURCE${names.length===1?'':'S'} ONLINE / INSTANT PLAYBACK`:'CONNECT A SOURCE IN RENDER';
  }catch{
    ui.status.className='status offline';
    ui.status.querySelector('b').textContent='OFFLINE';
    sourceButtons().forEach(button=>{button.disabled=true;button.classList.remove('on');button.querySelector('small').textContent='OFFLINE'});
  }
}

function loadingRows(){
  ui.trackList.replaceChildren();
  for(let index=0;index<4;index+=1){
    const row=document.createElement('li');row.className='skeleton';
    for(let part=0;part<4;part+=1)row.append(document.createElement('i'));
    ui.trackList.append(row);
  }
}

function render(){
  const list=currentList(),saved=selectedIds();
  ui.trackList.replaceChildren();
  ui.resultTitle.textContent=state.library?'YOUR LIBRARY':state.tracks.length?'SEARCH RESULTS':'DISCOVER';
  ui.resultCount.textContent=`${list.length} ${state.library?'SAVED':'FOUND'}`;

  list.forEach((track,index)=>{
    const needsMatch=track.source==='yandex_music';
    const row=document.createElement('li');row.className=`track ${state.active?.id===track.id?'active':''}`;row.dataset.source=track.source;row.style.setProperty('--i',index);
    const cover=document.createElement('div');cover.className='cover';const image=safeImage(track.thumbnail);if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=decodeText(track.title||'?').slice(0,2).toUpperCase();
    const play=document.createElement('button');play.className='play';play.type='button';play.textContent=needsMatch?'↻':state.active?.id===track.id?'Ⅱ':'▶';play.setAttribute('aria-label',needsMatch?`Match and play ${decodeText(track.title)}`:`Play ${decodeText(track.title)}`);play.onclick=()=>state.active?.id===track.id?togglePlayback():playTrack(track);
    const name=document.createElement('div');name.className='name';const title=document.createElement('strong');title.textContent=decodeText(track.title)||'Unknown title';const artist=document.createElement('span');artist.textContent=decodeText(track.artist)||'Unknown artist';name.append(title,artist);
    const source=document.createElement('span');source.className=`tag ${track.source}`;source.textContent=sourceLabels[track.source]||track.source;
    const quality=document.createElement('span');quality.className='quality';quality.textContent=track.quality||'—';
    const duration=document.createElement('span');duration.className='duration';duration.textContent=formatTime(track.duration);
    const actions=document.createElement('div');actions.className='actions';
    const save=document.createElement('button');save.className=`save ${saved.has(track.id)?'saved':''}`;save.type='button';save.textContent=saved.has(track.id)?'✓ SAVED':'+ LIBRARY';save.onclick=()=>toggleSave(track);actions.append(save);
    if(track.download_url){const download=document.createElement('a');download.className='download';download.href=track.download_url;download.download='';download.rel='noopener';download.textContent='DOWNLOAD';actions.append(download)}
    const catalog=document.createElement('div');catalog.className='catalog-links';
    [['spotify','SPOTIFY'],['apple_music','APPLE'],['yandex_music','YANDEX']].forEach(([provider,label])=>{const href=track.catalog_links?.[provider];if(!href)return;const link=document.createElement('a');link.className='catalog-link';link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${label} ↗`;link.setAttribute('aria-label',`Find ${decodeText(track.title)} on ${label}`);catalog.append(link)});
    if(catalog.childElementCount)actions.append(catalog);
    row.append(cover,play,name,source,quality,duration,actions);ui.trackList.append(row);
  });
}

function toggleSave(track){
  const index=state.saved.findIndex(item=>item.id===track.id);
  if(index>=0)state.saved.splice(index,1);else state.saved.unshift({...track,title:decodeText(track.title),artist:decodeText(track.artist)});
  persist();render();
}

async function search(query=ui.searchInput.value.trim()){
  if(!query)return;
  if(!state.sources.size){setMessage('No search source is connected. Add a provider key in Render.','error');return}
  state.controller?.abort();state.controller=new AbortController();state.library=false;ui.libraryButton.classList.remove('active');ui.libraryButton.setAttribute('aria-pressed','false');
  ui.results.setAttribute('aria-busy','true');ui.searchButton.classList.add('searching');document.body.classList.add('is-searching');setMessage('SEARCHING CONNECTED SOURCES…','loading');loadingRows();ui.resultTitle.textContent='SEARCHING';ui.resultCount.textContent='—';ui.resultTime.textContent='PLEASE WAIT';
  const started=performance.now();
  try{
    const response=await fetch('/api/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},signal:state.controller.signal,body:JSON.stringify({query,limit:state.resultLimit,sources:[...state.sources],region:state.region,locale:navigator.language||null})});
    const data=await response.json();if(!response.ok)throw new Error(data.detail||'Search failed');
    state.tracks=data.tracks||[];
    const failures=Object.keys(data.errors||{}).map(source=>sourceLabels[source]||source);
    if(state.tracks.length){setMessage(failures.length?`Showing real results. Temporarily unavailable: ${failures.join(', ')}.`:'Select a track to play it instantly.',failures.length?'notice':'');}
    else setMessage(failures.length?`No playable results. Unavailable: ${failures.join(', ')}.`:'Nothing found. Try the artist and track title.','error');
    const variants=Math.max(1,data.query_variants?.length||1);ui.resultTime.textContent=`${data.elapsed_ms??Math.round(performance.now()-started)} MS · ${variants} QUER${variants===1?'Y':'IES'}`;
    const params=new URLSearchParams({q:query});if(state.region!=='AUTO')params.set('region',state.region);if(state.resultLimit!==60)params.set('limit',String(state.resultLimit));history.replaceState(null,'',`${location.pathname}?${params}`);
    render();
  }catch(error){
    if(error.name==='AbortError')return;
    state.tracks=[];render();setMessage(error.message||'Search is temporarily unavailable.','error');ui.resultTime.textContent='FAILED';
  }finally{ui.results.setAttribute('aria-busy','false');ui.searchButton.classList.remove('searching');document.body.classList.remove('is-searching')}
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
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;script.onerror=()=>reject(new Error('YouTube player could not load'));document.head.append(script);
    setTimeout(()=>{if(!window.YT?.Player)reject(new Error('YouTube player timed out'))},15000);
  });
  return state.youtubeApi;
}

function stopYouTube(){
  clearInterval(state.youtubeTicker);state.youtubeTicker=null;
  if(state.youtube){try{state.youtube.destroy()}catch{}state.youtube=null}
  ui.youtubePlayer.replaceChildren();ui.youtubeDock.hidden=true;
}

function setPlaying(playing){ui.playPause.querySelector('span').textContent=playing?'Ⅱ':'▶';ui.playPause.setAttribute('aria-label',playing?'Pause':'Play');document.body.classList.toggle('is-playing',playing)}

function updateTimeline(current,duration){
  if(!state.seeking)setRange(ui.progress,duration?Math.round((current/duration)*1000):0);
  ui.elapsed.textContent=formatTime(current);ui.totalTime.textContent=formatTime(duration);
}

async function playYouTube(track){
  ui.audio.pause();ui.audio.removeAttribute('src');stopYouTube();ui.youtubeDock.hidden=false;ui.youtubeDock.classList.remove('minimized');
  try{
    const YT=await ensureYouTubeApi(),videoId=youtubeId(track);if(!videoId)throw new Error('Invalid YouTube result');
    const target=document.createElement('div');ui.youtubePlayer.replaceChildren(target);
    state.youtube=new YT.Player(target,{width:'100%',height:'100%',videoId,playerVars:{autoplay:1,controls:1,playsinline:1,rel:0,origin:location.origin},events:{
      onReady:event=>{event.target.setVolume(Number(ui.volume.value));event.target.playVideo();setPlaying(true);state.youtubeTicker=setInterval(()=>{if(state.youtube?.getCurrentTime)updateTimeline(state.youtube.getCurrentTime(),state.youtube.getDuration())},500)},
      onStateChange:event=>{if(event.data===YT.PlayerState.PLAYING)setPlaying(true);if(event.data===YT.PlayerState.PAUSED)setPlaying(false);if(event.data===YT.PlayerState.ENDED)nextTrack()},
      onError:()=>setMessage('This YouTube track cannot be embedded. Try another result.','error')
    }});
  }catch(error){ui.youtubeDock.hidden=true;setPlaying(false);setMessage(error.message||'YouTube playback is unavailable.','error')}
}

async function playAudio(track,recovered=false){
  stopYouTube();state.recovering=recovered;ui.audio.src=track.stream_url;ui.audio.volume=Number(ui.volume.value)/100;
  try{await ui.audio.play();setPlaying(true)}catch(error){if(error.name!=='NotAllowedError')setMessage('Playback could not start. Try another result.','error')}
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
  setMessage(`Matching “${decodeText(track.artist)} — ${decodeText(track.title)}” across connected sources…`,'loading');
  try{
    const sources=[...state.sources].filter(source=>state.available.has(source));
    const response=await fetch('/api/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:`${track.artist==='Yandex Music'?'':track.artist} ${track.title}`.trim(),limit:12,sources:sources.length?sources:[...state.available],region:state.region,locale:navigator.language||null})});
    const data=await response.json();if(!response.ok)throw new Error(data.detail||'Matching failed');const candidates=data.tracks||[];if(!candidates.length)throw new Error('No playable match was found. Use the Yandex link or try a manual search.');
    const fresh=[...candidates].sort((left,right)=>matchScore(right,track)-matchScore(left,track))[0];fresh.catalog_links={...fresh.catalog_links,...track.catalog_links};fresh.import_origin='yandex_music';
    const savedIndex=state.saved.findIndex(item=>item.id===track.id);if(savedIndex>=0)state.saved[savedIndex]=fresh;persist();render();setMessage(`Matched on ${sourceLabels[fresh.source]||fresh.source}.`,'notice');await playTrack(fresh);
  }catch(error){setMessage(error.message||'This imported track could not be matched.','error')}
}

async function playTrack(track){
  if(track.source==='yandex_music'){await matchImportedTrack(track);return}
  state.active=track;state.recovering=false;ui.player.hidden=false;ui.nowTitle.textContent=decodeText(track.title);ui.nowArtist.textContent=`${decodeText(track.artist)} · ${sourceLabels[track.source]||track.source}`;ui.nowSource.textContent=track.source;
  const image=safeImage(track.thumbnail);ui.playerArtwork.style.backgroundImage=image?`url("${image}")`:'';ui.playerArtwork.querySelector?.('span')?.remove();if(!image)ui.playerArtwork.textContent=(decodeText(track.title)||'AW').slice(0,2).toUpperCase();else ui.playerArtwork.textContent='';
  updateTimeline(0,track.duration||0);updateMediaSession(track);render();
  if(track.source==='youtube')await playYouTube(track);else await playAudio(track);
}

function pausePlayback(){if(state.active?.source==='youtube'){try{state.youtube?.pauseVideo()}catch{}}else ui.audio.pause();setPlaying(false)}
function resumePlayback(){if(state.active?.source==='youtube'){try{state.youtube?.playVideo()}catch{}}else ui.audio.play().catch(()=>{});setPlaying(true)}
function togglePlayback(){if(!state.active)return;const playing=state.active.source==='youtube'?state.youtube?.getPlayerState?.()===1:!ui.audio.paused;playing?pausePlayback():resumePlayback()}

function adjacentTrack(direction){const list=currentList();if(!list.length)return null;const index=Math.max(0,list.findIndex(track=>track.id===state.active?.id));return list[(index+direction+list.length)%list.length]}
function previousTrack(){const track=adjacentTrack(-1);if(track)playTrack(track)}
function nextTrack(){const track=adjacentTrack(1);if(track)playTrack(track)}
function seekRelative(offset){const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;const current=state.active?.source==='youtube'?state.youtube?.getCurrentTime?.():ui.audio.currentTime;seekTo(Math.max(0,Math.min(duration||0,(current||0)+offset)),true)}
function seekTo(seconds,allowSeek=true){if(state.active?.source==='youtube'){try{state.youtube?.seekTo(seconds,allowSeek)}catch{}}else if(Number.isFinite(ui.audio.duration))ui.audio.currentTime=seconds}

async function recoverAudio(){
  if(!state.active||state.active.source==='youtube'||state.recovering||!state.available.has(state.active.source))return;
  state.recovering=true;setMessage('Refreshing an expired playback link…','loading');
  try{
    const response=await fetch('/api/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:`${state.active.artist} ${state.active.title}`,limit:5,sources:[state.active.source],region:state.region,locale:navigator.language||null})});const data=await response.json();
    const fresh=(data.tracks||[]).find(track=>track.id===state.active.id)||(data.tracks||[])[0];if(!fresh)throw new Error();
    const savedIndex=state.saved.findIndex(track=>track.id===state.active.id);if(savedIndex>=0){state.saved[savedIndex]=fresh;persist()}state.active=fresh;await playAudio(fresh,true);setMessage('Playback link refreshed.','notice');
  }catch{setMessage('This saved link expired and could not be refreshed. Search for the track again.','error')}
}

sourceButtons().forEach(button=>button.addEventListener('click',()=>{const source=button.dataset.source;if(!state.available.has(source))return;if(state.sources.has(source))state.sources.delete(source);else state.sources.add(source);button.classList.toggle('on',state.sources.has(source))}));
ui.regionSelect.addEventListener('change',()=>{state.region=regions.includes(ui.regionSelect.value)?ui.regionSelect.value:'AUTO';localStorage.setItem('awun-region',state.region)});
ui.limitSelect.addEventListener('change',()=>{const value=Number(ui.limitSelect.value);state.resultLimit=resultLimits.includes(value)?value:60;localStorage.setItem('awun-result-limit',String(state.resultLimit))});
ui.themeButton.addEventListener('click',()=>ui.themePanel.hidden?openThemePanel():closeThemePanel());ui.themeClose.addEventListener('click',closeThemePanel);ui.themeBackdrop.addEventListener('click',closeThemePanel);
ui.importButton.addEventListener('click',()=>ui.importPanel.hidden?openImportPanel():closeImportPanel());ui.importClose.addEventListener('click',closeImportPanel);ui.importBackdrop.addEventListener('click',closeImportPanel);ui.importFileButton.addEventListener('click',()=>ui.libraryFile.click());ui.importSubmit.addEventListener('click',importLibrary);
ui.libraryFile.addEventListener('change',async()=>{const file=ui.libraryFile.files?.[0];if(!file)return;if(file.size>2*1024*1024){ui.importStatus.textContent='Choose a file smaller than 2 MB.';return}try{ui.importText.value=await file.text();ui.importFileName.textContent=file.name;const count=parseImportedLibrary(ui.importText.value,file.name).length;ui.importStatus.textContent=`${count} unique track${count===1?'':'s'} ready to import.`}catch(error){ui.importStatus.textContent=error.message||'The selected file could not be read.'}});
document.querySelectorAll('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>{state.theme=button.dataset.themeChoice;applyVisual()}));
ui.motionToggle.addEventListener('click',()=>{state.motion=state.motion==='on'?'off':'on';applyVisual()});ui.decorToggle.addEventListener('click',()=>{state.decor=state.decor==='full'?'minimal':'full';applyVisual()});
ui.searchForm.addEventListener('submit',event=>{event.preventDefault();search()});
ui.libraryButton.addEventListener('click',()=>{state.library=!state.library;ui.libraryButton.classList.toggle('active',state.library);ui.libraryButton.setAttribute('aria-pressed',String(state.library));setMessage(state.library?(state.saved.length?'Saved tracks stay on this device.':'Your library is empty. Save a result to keep it here.'):'');render()});
ui.playPause.addEventListener('click',togglePlayback);ui.previousTrack.addEventListener('click',previousTrack);ui.nextTrack.addEventListener('click',nextTrack);
ui.closePlayer.addEventListener('click',()=>{pausePlayback();stopYouTube();ui.player.hidden=true;state.active=null;render()});
ui.minimizeVideo.addEventListener('click',()=>{ui.youtubeDock.classList.toggle('minimized');ui.minimizeVideo.textContent=ui.youtubeDock.classList.contains('minimized')?'□':'—'});
ui.progress.addEventListener('pointerdown',()=>{state.seeking=true});ui.progress.addEventListener('pointerup',()=>{state.seeking=false;const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;seekTo((Number(ui.progress.value)/1000)*(duration||0),true)});ui.progress.addEventListener('input',()=>{setRange(ui.progress,ui.progress.value);const duration=state.active?.source==='youtube'?state.youtube?.getDuration?.():ui.audio.duration;ui.elapsed.textContent=formatTime((Number(ui.progress.value)/1000)*(duration||0))});
ui.volume.addEventListener('input',()=>{setRange(ui.volume,ui.volume.value);const value=Number(ui.volume.value);ui.audio.volume=value/100;try{state.youtube?.setVolume(value)}catch{}ui.muteButton.textContent=value?'VOL':'MUTE'});
ui.muteButton.addEventListener('click',()=>{const muted=Number(ui.volume.value)===0;if(muted)setRange(ui.volume,Math.round(state.lastVolume*100)||82);else{state.lastVolume=Number(ui.volume.value)/100;setRange(ui.volume,0)}ui.volume.dispatchEvent(new Event('input'))});
ui.audio.addEventListener('timeupdate',()=>updateTimeline(ui.audio.currentTime,ui.audio.duration));ui.audio.addEventListener('loadedmetadata',()=>updateTimeline(ui.audio.currentTime,ui.audio.duration));ui.audio.addEventListener('play',()=>setPlaying(true));ui.audio.addEventListener('pause',()=>setPlaying(false));ui.audio.addEventListener('ended',nextTrack);ui.audio.addEventListener('error',recoverAudio);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!ui.importPanel.hidden){closeImportPanel();return}if(event.key==='Escape'&&!ui.themePanel.hidden){closeThemePanel();return}if(event.code==='Space'&&!['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)&&!ui.player.hidden){event.preventDefault();togglePlayback()}});

async function bootstrap(){
  const url=new URLSearchParams(location.search),requestedRegion=url.get('region')?.toUpperCase(),requestedLimit=Number(url.get('limit'));if(regions.includes(requestedRegion)){state.region=requestedRegion;localStorage.setItem('awun-region',state.region)}if(resultLimits.includes(requestedLimit)){state.resultLimit=requestedLimit;localStorage.setItem('awun-result-limit',String(requestedLimit))}ui.regionSelect.value=state.region;ui.limitSelect.value=String(state.resultLimit);
  applyVisual(false);updateClock();setInterval(updateClock,1000);persist();setRange(ui.volume,82);setRange(ui.progress,0);render();await refreshStatus();
  const query=url.get('q');if(query){ui.searchInput.value=query;search(query)}
}
bootstrap();
