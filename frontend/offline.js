/* Automatic offline copies use explicit provider downloads, never playback streams. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.SongvaleOfflineRules=api;root.SongvaleOffline=new api.Manager(root.awunApp,root.SongvaleCollections.local)}
})(typeof globalThis==='object'?globalThis:this,function(root){
  const MIB=1024*1024,MAX_BYTES=100*MIB,MAX_JOBS=256;
  const key=track=>`${track?.source||''}:${track?.id||''}`;
  const supported=track=>['audius','jamendo','internet_archive'].includes(track?.source);
  function descriptor(track){const result={};for(const field of ['id','source','title','artist','album','duration','quality','offline_allowed','offline_reason','license_url','thumbnail','recording_key','recording_duration'])if(track?.[field]!==undefined)result[field]=track[field];return result}
  function eligible(track,{liked=false,plays=0}={}){return supported(track)&&track?.offline_allowed!==false&&!track?.is_preview&&(liked||plays>=3)}
  function evictionOrder(files,jobs,{liked=new Set(),active=null}={}){
    return files.filter(file=>file.managed_download&&file.id!==active&&!liked.has(`${file.origin_source}:${file.origin_id}`)&&!jobs.some(job=>job.file_id===file.id&&(liked.has(key(job.track))||liked.has(job.track.recording_key))))
      .sort((a,b)=>Math.max(0,...jobs.filter(j=>j.file_id===a.id).map(j=>Number(j.used_at)||0))-Math.max(0,...jobs.filter(j=>j.file_id===b.id).map(j=>Number(j.used_at)||0)));
  }
  class Manager{
    constructor(app,store){
      this.app=app;this.store=store;this.live=new Map();this.invalid=new Set();this.controller=null;this.running=false;
      const settings=root.awunStorage.readJSON('awun-offline-settings-v1',{});
      this.settings={enabled:settings?.enabled!==false&&!app.playStoreMode,wifiOnly:settings?.wifiOnly===true,limit:[256,1024,3072,5120].includes(settings?.limit)?settings.limit:1024};
      const jobs=root.awunStorage.readJSON('awun-offline-jobs-v1',[]);
      this.jobs=Array.isArray(jobs)?jobs.filter(j=>['audius','jamendo','internet_archive','youtube','soundcloud'].includes(j?.track?.source)&&j.track.id&&j.track.title).slice(0,MAX_JOBS).map(j=>({...j,track:descriptor(j.track),state:['ready','blocked','error','evicted','queued'].includes(j.state)?j.state:'queued'})):[];
      this.jobs.filter(j=>j.error==='offlineCopyFailed'&&j.file_id).forEach(j=>this.invalid.add(j.file_id));
      this.ready=store.ready.then(()=>{this.reconcile();this.bind();this.render();void this.pump()});
    }
    t(name,values){return root.awunI18n.t(name,values)}
    owner(){return root.awunStorage.readText('songvale-account-owner-v1','guest')||'guest'}
    liked(){return new Set(this.app.state.saved.flatMap(track=>[...root.SongvaleRecordings.variants(track).map(key),root.SongvaleRecordings.key(track)]))}
    persist(){
      this.jobs=this.jobs.slice(-MAX_JOBS);
      const keys=new Set(this.jobs.map(j=>key(j.track)));for(const k of this.live.keys())if(!keys.has(k))this.live.delete(k);
      return root.awunStorage.writeJSON('awun-offline-jobs-v1',this.jobs.map(j=>({...j,track:descriptor(j.track)})),{backup:false});
    }
    reconcile(){
      for(const file of this.store.tracks){
        if(!file.managed_download||!file.origin_source||!file.origin_id)continue;
        const original={source:file.origin_source,id:file.origin_id,title:file.title,artist:file.artist,album:file.album,duration:file.duration,license_url:file.license_url};
        if(!this.jobs.some(job=>key(job.track)===key(original)))this.jobs.push({track:original,file_id:file.id,state:'ready',used_at:0,owner:this.owner()});
      }
      for(const job of this.jobs)if(job.state==='ready'&&!this.store.tracks.some(file=>file.id===job.file_id)){job.state='error';job.error='localMissing';job.file_id=null}
      this.persist();
    }
    jobFor(track,readyOnly=false){
      const keys=new Set(root.SongvaleRecordings.variants(track).map(key)),canonical=root.SongvaleRecordings.key(track);
      return this.jobs.find(j=>(!readyOnly||j.state==='ready')&&(keys.has(key(j.track))||j.track.recording_key===canonical));
    }
    fileFor(track){
      const job=this.jobFor(track,true);
      const file=job&&this.store.tracks.find(f=>f.id===job.file_id);
      return file&&!this.invalid.has(file.id)?file:null;
    }
    duplicateOfFavorite(file){const liked=this.liked();return file.managed_download&&this.jobs.some(job=>job.file_id===file.id&&job.state==='ready'&&(liked.has(key(job.track))||liked.has(job.track.recording_key)))}
    originalFor(file){const job=this.jobs.find(j=>j.file_id===file.id&&j.state==='ready');return job?{...job.track,stream_url:'',stream_type:'audio'}:file}
    stateFor(track){if(track.source==='local')return 'ready';if(this.fileFor(track))return 'ready';const state=this.jobFor(track)?.state;return state==='ready'?'error':state||''}
    decorate(row,track){
      const cover=row.querySelector('.cover');if(!cover)return;
      let mark=cover.querySelector('.offline-mark');const state=this.stateFor(track);
      if(!state){mark?.remove();return}
      if(!mark){mark=document.createElement('span');mark.className='offline-mark';cover.append(mark)}
      mark.textContent=state==='ready'?'↓':state==='downloading'?'…':state==='queued'?'◷':'!';mark.dataset.state=state;mark.title=this.t(`offlineState${state[0].toUpperCase()+state.slice(1)}`);mark.setAttribute('aria-label',mark.title);
    }
    async request(track,{liked=false,plays=0}={}){
      await this.ready;if(!this.settings.enabled||this.app.playStoreMode||track.source==='local')return;
      const allowed=root.SongvaleRecordings.variants(track).find(variant=>supported(variant)&&variant.offline_allowed===true&&!variant.is_preview);
      if(allowed)track={...allowed,recording_key:root.SongvaleRecordings.key(track),recording_duration:track.recording_duration||track.duration};
      const existing=this.jobs.find(j=>key(j.track)===key(track));
      if(existing&&['ready','queued','downloading'].includes(existing.state))return;
      if(!liked&&plays<3)return;
      this.live.set(key(track),track);
      const blocked=!supported(track)||track.is_preview||track.offline_allowed===false;
      const job=existing||{track:descriptor(track),owner:this.owner(),used_at:0};job.track=descriptor(track);job.state=blocked?'blocked':'queued';job.error=blocked?'offlineNotAllowed':'';job.progress=0;
      if(!existing)this.jobs.push(job);
      if(!this.persist()){job.state='error';job.error='localStorageUnavailable';this.render();return}
      this.render();void this.pump();
    }
    networkPause(){
      if(!root.navigator.onLine)return 'offlineWaitingNetwork';
      if(root.navigator.connection?.saveData)return 'offlineDataSaver';
      if(this.settings.wifiOnly&&!['wifi','ethernet'].includes(root.navigator.connection?.type))return 'offlineWaitingWifi';
      return '';
    }
    validURL(value){
      try{const url=new URL(value,root.location.href),origins=[root.location.origin,this.app.apiBase,this.app.fallbackApiBase].filter(Boolean).map(v=>new URL(v).origin);return origins.includes(url.origin)&&url.pathname.includes('/media/')&&url.searchParams.get('offline')==='1'?url.href:''}catch{return ''}
    }
    async refresh(job,signal,force=false){
      const live=!force&&this.live.get(key(job.track));if(live?.offline_allowed&&this.validURL(live.offline_url))return live;
      const {data}=await this.app.requestSearch({query:`${job.track.artist} ${job.track.title}`.slice(0,200),sources:[job.track.source],limit:50,region:this.app.state.region,fast:true,refresh:true},{signal,waitForFallback:true,timeoutMs:14000});
      const fresh=(data.tracks||[]).find(t=>key(t)===key(job.track));
      if(!fresh||!fresh.offline_allowed||!this.validURL(fresh.offline_url))throw new Error('offlineNotAllowed');
      this.live.set(key(fresh),fresh);return fresh;
    }
    async readAudio(track,signal,onProgress){
      const response=await fetch(this.validURL(track.offline_url),{signal,cache:'no-store',credentials:'omit'});
      if(!response.ok)throw new Error(response.status===403?'offlineLinkExpired':'offlineDownloadFailed');
      if(response.status===206)throw new Error('offlineDownloadFailed');
      const length=Number(response.headers.get('content-length'))||0;
      if(length>MAX_BYTES){await response.body?.cancel();throw new Error('localTooLarge')}
      const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
      const types={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac','audio/x-flac':'flac','audio/mp4':'m4a','audio/aac':'aac','audio/ogg':'ogg','audio/webm':'webm'};
      let extension=types[type];
      if(!extension&&type==='application/octet-stream'){const name=response.headers.get('content-disposition')||'';extension=/\.(mp3|flac|wav|m4a|ogg|aac|webm)(?:["';]|$)/i.exec(name)?.[1]?.toLowerCase()||'mp3'}
      if(!extension){await response.body?.cancel();throw new Error('localUnsupported')}
      const reader=response.body.getReader(),chunks=[];let size=0,last=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('localTooLarge')}chunks.push(value);if(performance.now()-last>250){onProgress(length?Math.min(99,Math.floor(size/length*100)):null);last=performance.now()}}}finally{reader.releaseLock()}
      if(!size||length&&size!==length)throw new Error('offlineDownloadFailed');
      const mime=types[type]?type:{mp3:'audio/mpeg',flac:'audio/flac',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',aac:'audio/aac',webm:'audio/webm'}[extension];
      return new File(chunks,`Songvale.${extension}`,{type:mime});
    }
    async reserve(size){
      const total=()=>this.store.tracks.filter(f=>f.managed_download).reduce((n,f)=>n+f.size,0);
      const limit=this.settings.limit*MIB;if(size>limit)throw new Error('localStorageFull');
      const active=this.app.state.active?.local_file_id||this.app.state.active?.id;
      const protectedIds=new Set([this.app.state.pendingTrackId,this.app.state.pendingOfflineFileId,this.app.state.fadingFileId]);
      for(const file of evictionOrder(this.store.tracks.filter(f=>!protectedIds.has(f.id)),this.jobs,{liked:this.liked(),active})){
        if(total()+size<=limit)break;await this.store.remove(file.id);
        for(const job of this.jobs)if(job.file_id===file.id){job.state='evicted';job.file_id=null}
      }
      if(total()+size>limit)throw new Error('offlinePinnedFull');
    }
    async pump(){
      await this.ready;if(this.running){this.wake=true;return}if(!this.settings.enabled||this.app.playStoreMode)return;
      if(root.navigator.locks){await root.navigator.locks.request('songvale-offline-download',{ifAvailable:true},async lock=>{if(lock)await this.runQueue()})}
      else await this.runQueue();
    }
    async runQueue(){
      if(this.running)return;this.running=true;
      try{
        while(this.settings.enabled&&!this.networkPause()){
          const job=this.jobs.find(j=>j.state==='queued'&&(!j.owner||j.owner===this.owner()));if(!job)break;
          this.controller=new AbortController();const signal=this.controller.signal,timer=setTimeout(()=>this.controller?.abort(),120000);
          job.state='downloading';this.persist();this.render();
          try{
            if(this.store.loadError)throw new Error('localStorageUnavailable');
            let track=await this.refresh(job,signal),file;
            try{file=await this.readAudio(track,signal,value=>{job.progress=value;this.render()})}
            catch(error){if(error.message!=='offlineLinkExpired')throw error;track=await this.refresh(job,signal,true);file=await this.readAudio(track,signal,value=>{job.progress=value;this.render()})}
            await this.store.inspectFile(file);if(signal.aborted)throw new DOMException('Cancelled','AbortError');
            const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),id=`local_${[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
            if(this.invalid.has(id)){const old=this.store.tracks.find(f=>f.id===id);if(old){const protectedIds=new Set([this.app.state.active?.id,this.app.state.active?.local_file_id,this.app.state.pendingTrackId,this.app.state.pendingOfflineFileId,this.app.state.fadingFileId]);if(!old.managed_download||protectedIds.has(id))throw new Error('localStopBeforeRemove');await this.store.remove(id)}}
            if(!this.store.tracks.some(f=>f.id===id))await this.reserve(file.size);
            if(signal.aborted)throw new DOMException('Cancelled','AbortError');
            const result=await this.store.importFile(file,{title:track.title,artist:track.artist,album:track.album||'',managed_download:true,origin_source:track.source,origin_id:track.id,origin_url:track.catalog_links?.[track.source]||track.rights_terms_url||'',license_url:track.license_url||'',signal});
            job.file_id=result.track.id;job.state='ready';job.progress=100;job.error='';job.used_at=Date.now();
            this.invalid.delete(result.track.id);
            void root.navigator.storage?.persist?.().catch(()=>{});
            this.app.updateLibraryCount();this.app.render();document.dispatchEvent(new CustomEvent('awun:local-files'));
          }catch(error){job.state=signal.aborted?'queued':error.message==='offlineNotAllowed'?'blocked':'error';job.error=signal.aborted?'offlinePaused':/^(local|offline)[A-Z]/.test(error.message)?error.message:'offlineDownloadFailed';if(signal.aborted)break}
          finally{clearTimeout(timer);this.controller=null;this.persist();this.render()}
        }
      }finally{this.running=false;this.render();if(this.wake){this.wake=false;void this.pump()}}
    }
    async resolve(track,signal){
      if(root.navigator.onLine&&!this.jobFor(track,true))return track;
      await this.ready;const file=this.fileFor(track);if(!file){if(!root.navigator.onLine)throw new Error('offlineOnlineRequired');return track}
      this.app.state.pendingOfflineFileId=file.id;
      try{
        const local=await this.store.resolve(file,signal),job=this.jobs.find(j=>j.file_id===file.id&&j.state==='ready');job.used_at=Date.now();this.persist();
        return {...track,source:job.track.source,id:job.track.id,recording_key:root.SongvaleRecordings.key(track),recording_duration:track.recording_duration||track.duration,stream_url:local.stream_url,online_stream_url:track.stream_url||'',stream_type:'audio',duration:local.duration||track.duration,offline_playback:true,local_file_id:file.id};
      }catch(error){if(signal?.aborted)throw error;this.reject({...track,local_file_id:file.id});if(!root.navigator.onLine)throw error;return track}
      finally{if(this.app.state.pendingOfflineFileId===file.id)this.app.state.pendingOfflineFileId=null}
    }
    reject(track){this.invalid.add(track.local_file_id);const job=this.jobs.find(j=>key(j.track)===key(track));if(job){job.state='error';job.error='offlineCopyFailed';this.persist();this.render()}}
    retry(){for(const job of this.jobs)if(['error','queued'].includes(job.state))job.state='queued';this.persist();void this.pump()}
    async clear(){
      this.settings.enabled=false;this.saveSettings();this.controller?.abort();
      while(this.running)await new Promise(resolve=>setTimeout(resolve,50));
      const active=this.app.state.active?.local_file_id||this.app.state.active?.id;
      const protectedIds=new Set([active,this.app.state.pendingTrackId,this.app.state.pendingOfflineFileId,this.app.state.fadingFileId]);
      for(const file of [...this.store.tracks])if(file.managed_download&&!protectedIds.has(file.id))await this.store.remove(file.id);
      this.jobs=this.jobs.filter(j=>this.store.tracks.some(f=>f.id===j.file_id));this.persist();this.app.updateLibraryCount();this.app.render();this.render();document.dispatchEvent(new CustomEvent('awun:local-files'));
    }
    saveSettings(){root.awunStorage.writeJSON('awun-offline-settings-v1',this.settings)}
    bind(){
      const $=id=>document.getElementById(id);
      $('offlineEnabled').addEventListener('change',event=>{this.settings.enabled=event.target.checked;this.saveSettings();if(!this.settings.enabled)this.controller?.abort();this.render();void this.pump()});
      $('offlineWifiOnly').addEventListener('change',event=>{this.settings.wifiOnly=event.target.checked;this.saveSettings();if(this.networkPause())this.controller?.abort();this.render();void this.pump()});
      $('offlineLimit').addEventListener('change',event=>{this.settings.limit=Number(event.target.value);this.saveSettings();void this.reserve(0).catch(error=>{$('offlineStatus').textContent=this.t(error.message)}).then(()=>{this.persist();this.app.updateLibraryCount();this.app.render();this.render()})});
      $('offlineRetry').addEventListener('click',()=>this.retry());
      $('offlineClear').addEventListener('click',()=>{void this.clear().catch(()=>{$('offlineStatus').textContent=this.t('localStorageUnavailable')})});
      $('offlineFiles').addEventListener('click',()=>{this.app.ui.themeClose.click();void root.SongvaleCollections.openFiles()});
      document.addEventListener('awun:library',event=>{if(event.detail.saved)void this.request(event.detail.track,{liked:true});this.render()});
      document.addEventListener('awun:qualified-play',event=>{const track=event.detail.track;void this.request(track,{liked:this.liked().has(key(track)),plays:event.detail.plays})});
      document.addEventListener('awun:language',()=>this.render());
      document.addEventListener('awun:local-files',()=>{this.reconcile();this.render()});
      root.addEventListener('online',()=>{this.retry();this.render()});root.addEventListener('offline',()=>{this.controller?.abort();this.render()});
      root.navigator.connection?.addEventListener('change',()=>{if(this.networkPause())this.controller?.abort();this.render();void this.pump()});
      root.addEventListener('storage',event=>{if(event.key==='awun-offline-jobs-v1'&&!this.running){const jobs=root.awunStorage.readJSON(event.key,[]);if(Array.isArray(jobs)){this.jobs=jobs.filter(j=>['audius','jamendo','internet_archive','youtube','soundcloud'].includes(j?.track?.source)).slice(-MAX_JOBS);void this.store.load().then(()=>{this.reconcile();this.render();this.app.render();void this.pump()})}}});
    }
    render(){
      const $=id=>document.getElementById(id);if(!$('offlineEnabled'))return;
      $('offlineEnabled').checked=this.settings.enabled;$('offlineEnabled').disabled=this.app.playStoreMode;$('offlineWifiOnly').checked=this.settings.wifiOnly;$('offlineLimit').value=String(this.settings.limit);
      const ready=this.jobs.filter(j=>j.state==='ready'&&this.fileFor(j.track)).length,queued=this.jobs.filter(j=>j.state==='queued').length,errors=this.jobs.filter(j=>['blocked','error'].includes(j.state)).length,bytes=this.store.tracks.filter(f=>f.managed_download).reduce((n,f)=>n+f.size,0);
      const active=this.jobs.find(j=>j.state==='downloading');
      $('offlineStatus').textContent=this.app.playStoreMode?this.t('offlineBuildDisabled'):this.store.loadError?this.t('localStorageUnavailable'):active?this.t('offlineDownloading',{title:active.track.title,progress:active.progress==null?'…':`${active.progress||0}%`}):this.networkPause()&&queued?this.t(this.networkPause()):!this.settings.enabled?this.t('offlinePaused'):this.t('offlineSummary',{ready,queued,errors,size:Math.ceil(bytes/MIB)});
      $('offlineRetry').disabled=this.running||!this.settings.enabled||!this.jobs.some(j=>['error','queued'].includes(j.state));
      const list=$('offlineJobs');list.replaceChildren();
      for(const job of [...this.jobs].reverse().slice(0,12)){
        const item=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('span');name.textContent=`${job.track.artist} — ${job.track.title}`;detail.textContent=this.t(job.error||`offlineState${job.state[0].toUpperCase()+job.state.slice(1)}`);item.append(name,detail);if(/^https?:\/\//.test(job.track.license_url||'')){const license=document.createElement('a');license.href=job.track.license_url;license.textContent=this.t('offlineLicense');license.target='_blank';license.rel='noopener noreferrer';item.append(license)}list.append(item);
      }
      const tracks=new Map(this.app.currentList().map(track=>[track.id,track]));document.querySelectorAll('#trackList .track').forEach(row=>{const track=tracks.get(row.dataset.trackId);if(track)this.decorate(row,track)});
    }
  }
  return {key,descriptor,supported,eligible,evictionOrder,Manager};
});
