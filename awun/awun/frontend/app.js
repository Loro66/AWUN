const state={tracks:[],saved:JSON.parse(localStorage.getItem('awun-library')||'[]'),sources:new Set(['youtube','soundcloud','vk']),library:false,active:null};
const $=id=>document.getElementById(id);
const escDuration=s=>`${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
const savedIds=()=>new Set(state.saved.map(track=>track.id));

function persist(){localStorage.setItem('awun-library',JSON.stringify(state.saved));$('libraryButton').querySelector('b').textContent=String(state.saved.length).padStart(2,'0')}
function setMessage(text,loading=false){$('message').textContent=text;$('message').classList.toggle('loading',loading)}
function safeImage(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return ''}}

async function status(){try{const response=await fetch('/health');const data=await response.json();$('status').className='status live';$('status').innerHTML='<i></i>LIVE · '+(data.sources||[]).join(' / ').toUpperCase()}catch{$('status').className='status offline';$('status').innerHTML='<i></i>OFFLINE'}}

function render(){
  const list=state.library?state.saved:state.tracks;
  const ids=savedIds();
  $('trackList').replaceChildren();
  $('resultHeader').hidden=!list.length;
  $('resultTitle').textContent=state.library?'YOUR LIBRARY':'SEARCH RESULTS';
  $('resultCount').textContent=`${list.length} ${state.library?'SAVED':'FOUND'}`;
  list.forEach((track,index)=>{
    const row=document.createElement('li');row.className='track';
    const cover=document.createElement('div');cover.className='cover';const image=safeImage(track.thumbnail);if(image)cover.style.backgroundImage=`url("${image}")`;else cover.textContent=(track.title||'?')[0];
    const play=document.createElement('button');play.className='play';play.type='button';play.textContent='▶';play.setAttribute('aria-label',`Play ${track.title}`);play.onclick=()=>playTrack(track);
    const name=document.createElement('div');name.className='name';const title=document.createElement('strong');title.textContent=track.title;const artist=document.createElement('span');artist.textContent=track.artist;name.append(title,artist);
    const source=document.createElement('span');source.className=`tag ${track.source}`;source.textContent=track.source;
    const quality=document.createElement('span');quality.className='quality';quality.textContent=track.quality;
    const duration=document.createElement('span');duration.className='duration';duration.textContent=escDuration(track.duration);
    const actions=document.createElement('div');actions.className='actions';const save=document.createElement('button');save.className=`save ${ids.has(track.id)?'saved':''}`;save.type='button';save.textContent=ids.has(track.id)?'✓ SAVED':'+ SAVE';save.onclick=()=>toggleSave(track);actions.append(save);
    if(track.download_url){const download=document.createElement('a');download.className='download';download.href=track.download_url;download.target='_blank';download.rel='noopener';download.textContent='DOWNLOAD';actions.append(download)}
    row.append(cover,play,name,source,quality,duration,actions);$('trackList').append(row);
  });
}

function toggleSave(track){const index=state.saved.findIndex(item=>item.id===track.id);if(index>=0)state.saved.splice(index,1);else state.saved.unshift(track);persist();render()}

function youtubeId(track){return track.id.startsWith('yt_')?track.id.slice(3):new URL(track.stream_url).searchParams.get('v')}
function playTrack(track){
  state.active=track;$('player').hidden=false;$('nowTitle').textContent=track.title;$('nowArtist').textContent=`${track.artist} · ${track.source}`;
  const audio=$('audio'),youtube=$('youtubePlayer');audio.pause();youtube.replaceChildren();
  if(track.source==='youtube'){
    audio.hidden=true;$('playPause').hidden=true;youtube.hidden=false;const frame=document.createElement('iframe');frame.allow='autoplay; encrypted-media; picture-in-picture';frame.allowFullscreen=true;frame.src=`https://www.youtube.com/embed/${encodeURIComponent(youtubeId(track))}?autoplay=1&playsinline=1`;youtube.append(frame);
  }else{
    youtube.hidden=true;audio.hidden=false;$('playPause').hidden=false;audio.src=track.stream_url;audio.play().catch(()=>setMessage('Playback is unavailable for this result.'));
  }
}

$('playPause').onclick=()=>{const audio=$('audio');if(audio.paused)audio.play();else audio.pause()};
$('closePlayer').onclick=()=>{$('audio').pause();$('youtubePlayer').replaceChildren();$('player').hidden=true};
$('libraryButton').onclick=()=>{state.library=!state.library;$('libraryButton').classList.toggle('active',state.library);setMessage('');render()};
document.querySelectorAll('[data-source]').forEach(button=>button.onclick=()=>{const source=button.dataset.source;if(state.sources.has(source))state.sources.delete(source);else state.sources.add(source);button.classList.toggle('on',state.sources.has(source))});

$('searchForm').addEventListener('submit',async event=>{
  event.preventDefault();const query=$('query').value.trim();if(!query||!state.sources.size)return;state.library=false;$('libraryButton').classList.remove('active');setMessage('SEARCHING REAL SOURCES…',true);
  try{
    const response=await fetch('/api/v1/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,limit:30,sources:[...state.sources]})});
    const data=await response.json();if(!response.ok)throw new Error(data.detail||'Search failed');state.tracks=data.tracks||[];
    if(!state.tracks.length){const unavailable=Object.keys(data.errors||{});setMessage(unavailable.length?`No playable results. Unavailable: ${unavailable.join(', ')}.`:'Nothing found. Try another query.')}else setMessage('');render();
  }catch(error){state.tracks=[];render();setMessage(error.message||'Search is temporarily unavailable.')}
});

persist();render();status();
