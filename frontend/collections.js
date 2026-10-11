/* Catalog pages and device collections share the existing player and queue. */
(() => {
  const app=window.awunApp,{state}=app,t=(key,values)=>window.awunI18n.t(key,values),$=id=>document.getElementById(id);
  const local=new window.SongvaleLocalMusic.Store(),page=$('collectionPage'),content=$('collectionContent'),status=$('collectionStatus');
  const albumKey='awun-albums-v1',cacheKey='awun-catalog-cache-v1';
  let saved=window.awunStorage.readJSON(albumKey,[]),view=null,controller=null,importing=false,stopImport=false,editId=null;
  if(!Array.isArray(saved))saved=[];
  saved=saved.filter(a=>a?.id&&typeof a.title==='string'&&Array.isArray(a.tracks)&&a.tracks.length<=1000).slice(0,60);
  function node(tag,cls='',text=''){const el=document.createElement(tag);el.className=cls;el.textContent=text;return el}
  function button(text,action,cls=''){const el=node('button',cls,text);el.type='button';el.addEventListener('click',action);return el}
  function announce(key,values={},error=false){status.textContent=t(key,values);status.dataset.tone=error?'error':'normal'}
  function errorText(error){return /^local[A-Z]|^catalog[A-Z]/.test(error?.message||'')?t(error.message):t('collectionUnavailable')}
  function open(title,kind){
    controller?.abort();controller=new AbortController();view={kind,title};
    document.body.classList.add('collection-open');page.hidden=false;content.replaceChildren();$('collectionTitle').textContent=title;status.textContent='';$('localEditor').hidden=true;
    $('collectionFilter').value='';$('collectionFilter').hidden=kind!=='files';$('collectionImport').hidden=kind!=='files';$('collectionCancelImport').hidden=!importing;
    $('collectionTitle').focus({preventScroll:true});page.scrollTop=0;return controller.signal;
  }
  function close(){controller?.abort();page.hidden=true;document.body.classList.remove('collection-open');view=null}
  function counters(){ $('localFilesCount').textContent=t('localCollectionCount',{count:local.tracks.length});$('savedAlbumsCount').textContent=t('savedAlbumsCount',{count:saved.length+localAlbums().length}); }
  function cache(){const value=window.awunStorage.readJSON(cacheKey,{});return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([path,entry])=>path.startsWith('/api/v1/catalog/')&&entry&&typeof entry.data==='object'&&entry.data&&!Array.isArray(entry.data)&&Number.isFinite(entry.at))):{}}
  async function catalog(path,signal){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const stored=cache();
    if(!navigator.onLine&&stored[path])return stored[path].data;
    const timeout=new AbortController(),relay=()=>timeout.abort();signal?.addEventListener('abort',relay,{once:true});
    const timer=setTimeout(relay,18000);
    try{
      let response=await app.awunFetch(path,{signal:timeout.signal});
      if(!response.ok&&app.fallbackApiBase&&[502,503,504].includes(response.status))response=await fetch(`${app.fallbackApiBase}${path}`,{signal:timeout.signal,credentials:'omit'});
      if(!response.ok)throw new Error('catalogUnavailable');
      const data=await response.json();stored[path]={data,at:Date.now()};
      const entries=Object.entries(stored).sort((a,b)=>b[1].at-a[1].at).slice(0,30);
      const value=Object.fromEntries(entries);if(JSON.stringify(value).length<1024*1024)window.awunStorage.writeJSON(cacheKey,value,{backup:false});
      return data;
    }catch(error){if(signal?.aborted)throw error;if(stored[path]){announce('catalogCached');return stored[path].data}throw error}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',relay)}
  }
  function cover(album){const el=node('span','collection-cover',album.title.slice(0,2).toUpperCase());if(album.artwork&&/^https:\/\/coverartarchive\.org\//.test(album.artwork)){const img=document.createElement('img');img.alt='';img.loading='lazy';img.src=album.artwork;img.onerror=()=>img.remove();el.append(img)}return el}
  function albumCard(album){const el=button('',()=>void openAlbum(album),'collection-album');el.append(cover(album),node('strong','',album.title),node('span','',album.artist),node('small','',[album.date,album.type].filter(Boolean).join(' · ')));return el}
  function localAlbums(artist){
    const groups=new Map();for(const track of local.tracks){if(!track.album||artist&&app.matchText(track.artist)!==app.matchText(artist))continue;const key=`${app.matchText(track.artist)}|${app.matchText(track.album)}`;if(!groups.has(key))groups.set(key,{id:`device:${key}`,title:track.album,artist:track.artist,date:'',type:t('localAlbum'),tracks:[],local:true});groups.get(key).tracks.push(track)}
    return [...groups.values()].map(a=>({...a,tracks:a.tracks.sort((x,y)=>(x.track_number||1000)-(y.track_number||1000)||x.title.localeCompare(y.title))}));
  }
  function artistButton(name){const el=button(name||t('unknownArtist'),()=>void openArtist(name),'collection-artist-link');el.disabled=!name;return el}
  function trackRow(track,index,{album=null,removable=false,context=[]}={}){
    const row=node('li','collection-track'),play=button('▶',async()=>{play.disabled=true;play.setAttribute('aria-busy','true');try{const selected=album&&!album.local?catalogTrack(album,index):track;app.replaceQueue(context.slice(index+1).map((entry,nextIndex)=>album&&!album.local?catalogTrack(album,index+1+nextIndex):entry));const started=await app.playTrack(selected,{preserveQueue:true});if(!started&&view)status.textContent=app.ui.playerStatus.textContent||t('catalogTrackMissing')}finally{play.disabled=false;play.setAttribute('aria-busy','false')}},'collection-play');
    play.setAttribute('aria-label',t('playTrackAria',{title:track.title}));
    const copy=node('div','collection-track-copy');copy.append(node('strong','',track.title),artistButton(track.artist));if(track.album&&!album)copy.append(node('small','',track.album));
    const queue=button('+',()=>{const selected=album&&!album.local?catalogTrack(album,index):track;app.appendQueue([selected]);announce('collectionQueued')},'collection-add');queue.setAttribute('aria-label',t('addToQueue'));
    row.append(node('span','collection-number',String(index+1).padStart(2,'0')),play,copy,node('span','collection-duration',track.duration?`${Math.floor(track.duration/60)}:${String(track.duration%60).padStart(2,'0')}`:'—'),queue);
    if(removable){const actions=node('div','collection-file-actions');actions.append(button(t('localEdit'),()=>edit(track)),button(t('localRemove'),()=>void remove(track)));row.append(actions)}
    return row;
  }
  function listTracks(tracks,options={}){const list=node('ol','collection-tracks');tracks.forEach((track,index)=>list.append(trackRow(track,index,{...options,context:tracks})));return list}
  async function openFiles(){await local.ready;open(t('localCollection'),'files');renderFiles()}
  function renderFiles(){
    if(view?.kind!=='files')return;const query=app.matchText($('collectionFilter').value),tracks=local.tracks.filter(track=>app.matchText(`${track.artist} ${track.title} ${track.album}`).includes(query));
    content.replaceChildren(node('p','collection-note',t('localDeviceNote')));
    if(local.loadError){announce('localStorageUnavailable',{},true);return}
    if(!tracks.length)content.append(node('p','collection-empty',t(query?'localNoMatches':'localEmptyCollection')));
    else{const controls=node('div','collection-actions');controls.append(button(t('collectionPlayAll'),()=>playTracks(tracks)));content.append(controls,listTracks(tracks,{removable:true}))}
    const albums=localAlbums();if(albums.length){content.append(node('h2','',t('localAlbums')));const grid=node('div','collection-albums');albums.forEach(a=>grid.append(albumCard(a)));content.append(grid)}
    counters();
  }
  function playTracks(tracks){if(!tracks.length)return;app.replaceQueue(tracks.slice(1));void app.playTrack(tracks[0],{preserveQueue:true})}
  function catalogTrack(album,index){const track=album.tracks[index];return {...track,id:`catalog:${album.id}:${index}`,source:'catalog',quality:'CATALOG',stream_url:'',album_ref:album.id,album_position:index,album:album.title,catalog_entry:track,thumbnail:album.artwork||null}}
  async function resolve(track,signal){
    if(track.source==='local')return local.resolve(track,signal);
    const entry=track.catalog_entry;if(!entry?.title)throw new Error('catalogTrackMissing');
    const own=local.tracks.find(value=>app.matchText(value.title)===app.matchText(entry.title)&&app.matchText(value.artist)===app.matchText(entry.artist));
    if(own)return {...await local.resolve(own,signal),album_ref:track.album_ref,album_position:track.album_position};
    if(!navigator.onLine)throw new Error('catalogOnlineRequired');
    const {data}=await app.requestSearch({query:`${entry.artist} ${entry.title}`,sources:[...state.sources],limit:20,region:state.region,fast:true},{signal,waitForFallback:true,timeoutMs:14000});
    const resolution=window.SongvaleLibraryMatcher.bestMatch(data.tracks||[],entry);
    if(!resolution?.candidate)throw new Error('catalogTrackMissing');
    return {...resolution.candidate,album_ref:track.album_ref,album_position:track.album_position,album:track.album};
  }
  async function openArtist(name){
    if(!name)return;await local.ready;const signal=open(name,'artist');
    const own=local.tracks.filter(track=>app.matchText(track.artist)===app.matchText(name));
    if(own.length){content.append(node('h2','',t('localCollection')),listTracks(own));const grid=node('div','collection-albums');localAlbums(name).forEach(a=>grid.append(albumCard(a)));content.append(grid)}
    const results=node('div','catalog-results');content.append(results);announce('catalogLoading');
    try{
      const data=await catalog(`/api/v1/catalog/artists?name=${encodeURIComponent(name)}`,signal);if(signal.aborted)return;
      const artists=data.artists||[],exact=artists.filter(a=>app.matchText(a.name)===app.matchText(name));
      if(artists.length===1||exact.length===1&&artists[0]?.id===exact[0].id&&artists[0].score>=95){await showArtist(artists.length===1?artists[0]:exact[0],results,signal);return}
      if(!artists.length){announce('catalogArtistMissing');return}
      announce('catalogChooseArtist');artists.forEach(a=>results.append(button(`${a.name} · ${[a.description,a.country,a.type].filter(Boolean).join(' · ')}`,()=>void showArtist(a,results,signal),'catalog-artist-choice')));
    }catch(error){if(!signal.aborted){status.textContent=errorText(error);status.dataset.tone='error'}}
  }
  async function showArtist(artist,target,signal,offset=0){
    announce('catalogLoading');
    try{
      const data=await catalog(`/api/v1/catalog/artists/${encodeURIComponent(artist.id)}/albums?offset=${offset}`,signal);if(signal.aborted)return;
      if(offset===0){target.replaceChildren(node('h2','',t('catalogReleases')));$('collectionTitle').textContent=data.artist.name;if(data.artist.description)target.append(node('p','collection-note',data.artist.description))}
      target.querySelector('.catalog-more')?.remove();const grid=node('div','collection-albums');[...(data.albums||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(a=>grid.append(albumCard(a)));target.append(grid);
      if(offset+(data.albums||[]).length<data.total)target.append(button(t('catalogMore'),()=>void showArtist(artist,target,signal,offset+data.albums.length),'catalog-more'));
      announce(data.albums?.length?'catalogListingNote':'catalogReleasesMissing');
    }catch(error){if(!signal.aborted){status.textContent=errorText(error);status.dataset.tone='error'}}
  }
  async function openAlbum(summary){
    const signal=open(summary.title,'album');announce('catalogLoading');
    try{
      let album=summary;
      if(!Array.isArray(album.tracks))album=saved.find(a=>a.id===summary.id)||await catalog(`/api/v1/catalog/albums/${encodeURIComponent(summary.id)}`,signal);
      if(signal.aborted)return;if(!Array.isArray(album.tracks)||!album.tracks.length)throw new Error('catalogTrackMissing');view.album=album;renderAlbum(album);
    }catch(error){if(!signal.aborted){status.textContent=errorText(error);status.dataset.tone='error'}}
  }
  function renderAlbum(album){
    content.replaceChildren();const header=node('div','collection-album-header'),info=node('div');info.append(artistButton(album.artist),node('p','collection-note',[album.date,album.edition,t('catalogAlbumCount',{count:album.tracks.length})].filter(Boolean).join(' · ')));header.append(cover(album),info);content.append(header);
    const controls=node('div','collection-actions');controls.append(button(t('collectionPlayAll'),()=>{const tracks=album.local?album.tracks:album.tracks.map((_,i)=>catalogTrack(album,i));playTracks(tracks);if(tracks.length>250)announce('collectionQueueLimit')}));
    if(!album.local)controls.append(button(t(saved.some(a=>a.id===album.id)?'catalogRemoveAlbum':'catalogSaveAlbum'),()=>{
      const exists=saved.some(a=>a.id===album.id);if(!exists&&saved.length>=60){announce('catalogAlbumLimit',{},true);return}
      const next=exists?saved.filter(a=>a.id!==album.id):[album,...saved];if(new TextEncoder().encode(JSON.stringify(next)).length>1024*1024){announce('catalogStorageFull',{},true);return}if(!window.awunStorage.writeJSON(albumKey,next)){announce('storageSaveFailed',{},true);return}saved=next;counters();renderAlbum(album);announce(exists?'catalogAlbumRemoved':'catalogAlbumSaved');
    }));
    content.append(controls,node('p','collection-note',t(album.local?'localDeviceNote':'catalogAlbumNote')),listTracks(album.tracks,{album}));announce(album.local?'localOfflineReady':'catalogListingNote');
  }
  function openSaved(){open(t('savedAlbums'),'albums');const albums=[...saved,...localAlbums()];if(!albums.length){content.append(node('p','collection-empty',t('catalogSavedEmpty')));return}const grid=node('div','collection-albums');albums.forEach(a=>grid.append(albumCard(a)));content.append(grid)}
  function edit(track){editId=track.id;$('localEditorTitle').value=track.title;$('localEditorArtist').value=track.artist;$('localEditorAlbum').value=track.album||'';$('localEditor').hidden=false;$('localEditorTitle').focus()}
  async function remove(track){
    if(state.active?.id===track.id){app.pausePlayback();announce('localStopBeforeRemove',{},true);return}
    try{await local.remove(track.id);state.queue=state.queue.filter(t=>t.id!==track.id);app.replaceQueue(state.queue);state.recents=state.recents.filter(t=>t.id!==track.id);window.awunStorage.writeJSON('awun-recent',state.recents.map(app.durableTrack));app.updateLibraryCount();app.render();renderFiles();announce('localRemoved')}
    catch(error){status.textContent=errorText(error);status.dataset.tone='error'}
  }
  async function importFiles(files){
    if(importing)return;await openFiles();importing=true;stopImport=false;$('collectionCancelImport').hidden=false;$('collectionImport').disabled=true;$('localImportFiles').disabled=true;
    let added=0,duplicates=0,failed=0;const errors=[];
    try{
      if(files.length>1000)throw new Error('localBatchLimit');
      for(let index=0;index<files.length&&!stopImport;index++){
        announce('localImportProgress',{done:index+1,total:files.length});
        try{const result=await local.importFile(files[index]);result.duplicate?duplicates++:added++}
        catch(error){failed++;errors.push(`${files[index].name}: ${errorText(error)}`)}
      }
      if(view?.kind!=='files')await openFiles();renderFiles();announce('localImportDone',{added,duplicates,failed});if(errors.length){const list=node('ul','collection-import-errors');errors.slice(0,30).forEach(value=>list.append(node('li','',value)));content.prepend(list)}
      void navigator.storage?.persist?.().catch(()=>{});
    }catch(error){status.textContent=errorText(error);status.dataset.tone='error'}
    finally{importing=false;$('collectionCancelImport').hidden=true;$('collectionImport').disabled=false;$('localImportFiles').disabled=false;counters();app.updateLibraryCount();app.render()}
  }
  $('collectionBack').addEventListener('click',()=>{close();app.showLibrary()});
  $('localFilesButton').addEventListener('click',()=>void openFiles());$('savedAlbumsButton').addEventListener('click',openSaved);
  $('localImportFiles').addEventListener('click',()=>$('localAudioInput').click());$('collectionImport').addEventListener('click',()=>$('localAudioInput').click());
  $('localAudioInput').addEventListener('change',event=>{const files=[...event.target.files];event.target.value='';if(files.length)void importFiles(files)});
  $('collectionFilter').addEventListener('input',renderFiles);$('collectionCancelImport').addEventListener('click',()=>{stopImport=true;announce('localImportStopping')});
  $('localEditorCancel').addEventListener('click',()=>{$('localEditor').hidden=true;editId=null});
  $('localEditor').addEventListener('submit',async event=>{event.preventDefault();try{await local.update(editId,{title:$('localEditorTitle').value,artist:$('localEditorArtist').value,album:$('localEditorAlbum').value});$('localEditor').hidden=true;renderFiles();announce('localEdited')}catch(error){status.textContent=errorText(error);status.dataset.tone='error'}});
  document.addEventListener('click',event=>{if(event.target.closest('.site-header .logo,#searchNavButton,#libraryButton,#flowButton'))close()},true);
  document.addEventListener('awun:language',()=>{counters();if(view?.kind==='files')renderFiles();else if(view?.kind==='albums')openSaved();else if(view?.album)renderAlbum(view.album)});
  document.addEventListener('awun:search',close);
  window.SongvaleCollections={openArtist,openFiles,openAlbum,openSaved,resolve,local};
  void local.ready.then(()=>{counters();app.updateLibraryCount();app.render()});counters();
})();
