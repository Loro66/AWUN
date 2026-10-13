/* User-selected audio stays on this device. No upload to the public backend. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SongvaleLocalMusic = api;
})(typeof globalThis === 'object' ? globalThis : this, function(root) {
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const MAX_FILES = 1000;
  const MIME = {mp3:'audio/mpeg',m4a:'audio/mp4',flac:'audio/flac',ogg:'audio/ogg',oga:'audio/ogg',wav:'audio/wav',aac:'audio/aac',webm:'audio/webm'};
  function mimeFor(name) { return MIME[String(name).split('.').pop().toLowerCase()] || ''; }
  function filenameTags(name) {
    const title = String(name).replace(/\.[^.]+$/, '').replace(/^(?:\d{1,3}[.)]|\d{1,2}[ _-])\s*/, '').trim();
    const parts = title.split(/\s+[—–-]\s+/);
    return {artist:parts.length>1?parts.shift():'',title:parts.join(' — ')||title,album:'',track_number:0,duration:0};
  }
  function readTags(buffer, name) {
    const result=filenameTags(name),bytes=new Uint8Array(buffer),view=new DataView(buffer);
    const ascii=(offset,length)=>String.fromCharCode(...bytes.slice(offset,offset+length));
    const sync=offset=>((bytes[offset]&127)<<21)|((bytes[offset+1]&127)<<14)|((bytes[offset+2]&127)<<7)|(bytes[offset+3]&127);
    function text(data) {
      if (!data.length) return '';
      const enc=data[0],body=data.slice(1);
      let encoding=enc===0?'windows-1252':enc===3?'utf-8':enc===2?'utf-16be':'utf-16le';
      if(enc===1&&body[0]===254&&body[1]===255)encoding='utf-16be';
      return new TextDecoder(encoding).decode(body).replace(/^\uFEFF/, '').replace(/\0.*$/s, '').trim().slice(0,200);
    }
    try {
      if(bytes.length>=10&&ascii(0,3)==='ID3'){
        const version=bytes[3],limit=Math.min(bytes.length,10+sync(6));
        if(![2,3,4].includes(version)||(bytes[5]&128))return result;
        let offset=10;
        if(bytes[5]&64)offset+=version===4?sync(offset):4+view.getUint32(offset);
        while(offset+(version===2?6:10)<=limit){
          const short=version===2,id=ascii(offset,short?3:4);
          if(!/^[A-Z0-9]+$/.test(id))break;
          const length=short?(bytes[offset+3]<<16)|(bytes[offset+4]<<8)|bytes[offset+5]:version===4?sync(offset+4):view.getUint32(offset+4);
          const start=offset+(short?6:10);if(!length||start+length>limit)break;
          const values={TIT2:'title',TT2:'title',TPE1:'artist',TP1:'artist',TALB:'album',TAL:'album',TRCK:'track_number',TRK:'track_number',TLEN:'duration'};
          const key=values[id];
          if(key){const value=text(bytes.slice(start,start+length));if(value)result[key]=key==='track_number'?parseInt(value,10)||0:key==='duration'?Math.round(Number(value)/1000)||0:value}
          offset=start+length;
        }
      }else if(bytes.length>=42&&ascii(0,4)==='fLaC'){
        let offset=4;
        while(offset+4<=bytes.length){
          const type=bytes[offset]&127,last=Boolean(bytes[offset]&128),length=(bytes[offset+1]<<16)|(bytes[offset+2]<<8)|bytes[offset+3],start=offset+4;
          if(start+length>bytes.length)break;
          if(type===0&&length===34){const rate=view.getUint32(start+10)>>>12,samples=(view.getUint32(start+10)&15)*4294967296+view.getUint32(start+14);if(rate)result.duration=Math.round(samples/rate)}
          if(type===4){
            let p=start;const vendor=view.getUint32(p,true);p+=4+vendor;if(p+4>start+length)break;
            const count=Math.min(view.getUint32(p,true),200);p+=4;
            for(let i=0;i<count&&p+4<=start+length;i++){
              const size=view.getUint32(p,true);p+=4;if(size>start+length-p)break;
              const value=new TextDecoder().decode(bytes.slice(p,p+size));p+=size;
              const at=value.indexOf('='),key={TITLE:'title',ARTIST:'artist',ALBUM:'album',TRACKNUMBER:'track_number'}[value.slice(0,at).toUpperCase()];
              if(key)result[key]=key==='track_number'?parseInt(value.slice(at+1),10)||0:value.slice(at+1).slice(0,200);
            }
          }
          offset=start+length;if(last)break;
        }
      }
    } catch { /* Damaged tags fall back to the filename; audio decoding is checked separately. */ }
    return result;
  }
  function requestValue(request) { return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}); }
  function completed(tx) { return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Storage transaction failed'))}); }
  function durationFor(file) {
    return new Promise((resolve,reject)=>{
      const audio=new Audio(),url=URL.createObjectURL(file);
      const finish=(error,value)=>{clearTimeout(timer);audio.onloadedmetadata=audio.onerror=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);error?reject(error):resolve(value)};
      const timer=setTimeout(()=>finish(new Error('localUnsupported')),6000);
      audio.preload='metadata';audio.onloadedmetadata=()=>finish(null,Number.isFinite(audio.duration)?Math.round(audio.duration):0);audio.onerror=()=>finish(new Error('localUnsupported'));audio.src=url;
    });
  }
  class Store {
    constructor(){this.tracks=[];this.database=null;this.config=null;this.activeURL=null;this.writeTail=Promise.resolve();this.ready=this.load();}
    async nativeConfig(){
      if(new URLSearchParams(root.location?.search||'').get('desktop')!=='1'||!['127.0.0.1','localhost','[::1]'].includes(root.location?.hostname))return null;
      if(!root.pywebview?.api?.local_audio_config){
        await new Promise(resolve=>{const done=()=>{clearTimeout(timer);root.removeEventListener('pywebviewready',done);resolve()};const timer=setTimeout(done,3000);root.addEventListener('pywebviewready',done,{once:true})});
      }
      if(!root.pywebview?.api?.local_audio_config)throw new Error('localStorageUnavailable');
      const config=await root.pywebview.api.local_audio_config();
      if(!config||typeof config.token!=='string'||!config.token)throw new Error('localStorageUnavailable');
      return config;
    }
    async openDatabase(){
      if(this.database)return this.database;
      if(!root.indexedDB)throw new Error('localStorageUnavailable');
      const request=root.indexedDB.open('songvale-local-audio',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('tracks',{keyPath:'id'});request.result.createObjectStore('files')};
      this.database=await requestValue(request);this.database.onversionchange=()=>{this.database.close();this.database=null};return this.database;
    }
    async native(path='',init={}){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000),relay=()=>controller.abort();
      if(init.signal?.aborted)relay();else init.signal?.addEventListener('abort',relay,{once:true});
      try{
        const response=await fetch(`/api/v1/local-audio${path}`,{...init,signal:controller.signal,headers:{...init.headers,'X-Songvale-Local-Token':this.config.token}});
        const data=await response.json();if(!response.ok)throw new Error(response.status===413?'localTooLarge':response.status===507?'localStorageFull':'localStorageUnavailable');return data;
      }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',relay)}
    }
    async load(){
      try{
        this.config=await this.nativeConfig();
        if(this.config)this.tracks=(await this.native()).tracks;
        else{const db=await this.openDatabase();this.tracks=await requestValue(db.transaction('tracks').objectStore('tracks').getAll())}
      }catch(error){this.loadError=error;this.tracks=[]}
      return this.tracks;
    }
    write(operation){const result=this.writeTail.then(operation);this.writeTail=result.catch(()=>{});return result}
    async inspectFile(file){
      this.inspected||=new WeakMap();if(this.inspected.has(file))return this.inspected.get(file);
      const inspection=(async()=>{
        const mime=mimeFor(file.name);if(!mime)throw new Error('localUnsupported');
        if(!file.size)throw new Error('localEmpty');if(file.size>MAX_FILE_BYTES)throw new Error('localTooLarge');
        const tags=readTags(await file.slice(0,1024*1024).arrayBuffer(),file.name),duration=await durationFor(file);
        return {mime,metadata:{...tags,duration:duration||tags.duration,filename:file.name}};
      })();this.inspected.set(file,inspection);return inspection;
    }
    importFile(file,details={}){return this.write(()=>this.importUnlocked(file,details))}
    async importUnlocked(file,details){
      await this.ready;if(this.loadError)throw this.loadError;
      if(details.signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const inspection=await this.inspectFile(file),mime=inspection.mime,metadata={...inspection.metadata};
      for(const key of ['title','artist','album'])if(typeof details[key]==='string')metadata[key]=details[key].slice(0,200);
      if(details.managed_download){metadata.managed_download=true;for(const key of ['origin_source','origin_id'])metadata[key]=String(details[key]||'').slice(0,200);for(const key of ['origin_url','license_url'])metadata[key]=String(details[key]||'').slice(0,1000)}
      if(details.signal?.aborted)throw new DOMException('Cancelled','AbortError');
      let track,duplicate=false;
      if(this.config){const data=await this.native('',{method:'POST',headers:{'Content-Type':mime,'X-Songvale-Local-Metadata':encodeURIComponent(JSON.stringify(metadata))},signal:details.signal,body:file});track=data.track;duplicate=data.duplicate}
      else{
        const hash=await root.crypto.subtle.digest('SHA-256',await file.arrayBuffer());
        const file_id=[...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join(''),id=`local_${file_id}`;
        track=this.tracks.find(t=>t.id===id);duplicate=Boolean(track);
        if(!track){
          if(this.tracks.length>=MAX_FILES)throw new Error('localStorageFull');
          const estimate=await root.navigator?.storage?.estimate?.();if(estimate?.quota&&estimate.quota-estimate.usage<file.size)throw new Error('localStorageFull');
          if(details.signal?.aborted)throw new DOMException('Cancelled','AbortError');
          track={...metadata,id,file_id,source:'local',quality:'LOCAL',stream_url:'',stream_type:'audio',mime,size:file.size,local_backend:'browser'};
          const db=await this.openDatabase(),tx=db.transaction(['tracks','files'],'readwrite'),done=completed(tx);
          tx.objectStore('tracks').put(track);tx.objectStore('files').put(file,id);
          try{await done}catch(error){if(error?.name==='QuotaExceededError')throw new Error('localStorageFull');throw error}
        }
      }
      if(!duplicate)this.tracks.push(track);return {track,duplicate};
    }
    update(id,values){return this.write(()=>this.updateUnlocked(id,values))}
    async updateUnlocked(id,values){
      const index=this.tracks.findIndex(t=>t.id===id);if(index<0)throw new Error('localMissing');
      let track={...this.tracks[index],...Object.fromEntries(['title','artist','album'].map(key=>[key,String(values[key]||'').trim().slice(0,200)]))};
      if(!track.title)throw new Error('localTitleRequired');
      if(this.config)track=(await this.native(`/${track.file_id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)})).track;
      else{const db=await this.openDatabase(),tx=db.transaction('tracks','readwrite'),done=completed(tx);tx.objectStore('tracks').put(track);await done}
      this.tracks[index]=track;return track;
    }
    remove(id){return this.write(()=>this.removeUnlocked(id))}
    async removeUnlocked(id){
      const track=this.tracks.find(t=>t.id===id);if(!track)return;
      if(this.config)await this.native(`/${track.file_id}`,{method:'DELETE'});
      else{const db=await this.openDatabase(),tx=db.transaction(['tracks','files'],'readwrite'),done=completed(tx);tx.objectStore('tracks').delete(id);tx.objectStore('files').delete(id);await done}
      this.tracks=this.tracks.filter(t=>t.id!==id);
    }
    release(){if(this.activeURL){URL.revokeObjectURL(this.activeURL);this.activeURL=null}}
    async prepare(track,signal){
      await this.ready;if(this.loadError)throw this.loadError;if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const stored=this.tracks.find(t=>t.id===track.id);if(!stored)throw new Error('localMissing');
      if(this.config)return {track:{...stored,stream_url:`/api/v1/local-audio/${stored.file_id}?token=${encodeURIComponent(this.config.token)}`},release:()=>{}};
      const db=await this.openDatabase(),file=await requestValue(db.transaction('files').objectStore('files').get(track.id));
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(!file)throw new Error('localMissing');
      const url=URL.createObjectURL(file);return {track:{...stored,stream_url:url},release:()=>URL.revokeObjectURL(url)};
    }
    async resolve(track,signal){
      await this.ready;if(this.loadError)throw this.loadError;
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const stored=this.tracks.find(t=>t.id===track.id);if(!stored)throw new Error('localMissing');
      if(this.config)return {...stored,stream_url:`/api/v1/local-audio/${stored.file_id}?token=${encodeURIComponent(this.config.token)}`};
      const db=await this.openDatabase(),file=await requestValue(db.transaction('files').objectStore('files').get(track.id));
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if(!file)throw new Error('localMissing');this.release();this.activeURL=URL.createObjectURL(file);return {...stored,stream_url:this.activeURL};
    }
  }
  return {Store,readTags,filenameTags,mimeFor,MAX_FILE_BYTES,MAX_FILES};
});
