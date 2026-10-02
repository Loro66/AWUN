const SONGVALE_VERSION='__AWUN_VERSION__';
const CACHE=`songvale-shell-${SONGVALE_VERSION}-ios-v1`;
const SHELL=['/','/design-system.css?v=__AWUN_VERSION__','/static/manifest.webmanifest','/static/desktop-bridge.js?v=__AWUN_VERSION__','/static/storage.js?v=__AWUN_VERSION__','/static/runtime-log.js?v=__AWUN_VERSION__','/static/update-checker.js?v=__AWUN_VERSION__','/static/i18n.js?v=__AWUN_VERSION__','/static/player-core.js?v=__AWUN_VERSION__','/static/library-matcher.js?v=__AWUN_VERSION__','/static/audio-engine.js?v=__AWUN_VERSION__','/static/home-hub.js?v=__AWUN_VERSION__','/static/app.js?v=__AWUN_VERSION__','/static/flow.js?v=__AWUN_VERSION__','/static/brand/black-forest-michiel-annaert.webp','/static/brand/songvale-mark.svg','/static/brand/songvale-icon.png','/static/brand/songvale-maskable.png'];
const NEVER_CACHE=new Set(['/health','/docs','/openapi.json']);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('songvale-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||NEVER_CACHE.has(url.pathname)||event.request.destination==='audio'||event.request.destination==='video')return;
  if(event.request.mode==='navigate'&&url.pathname==='/'){
    event.respondWith(caches.match('/').then(cached=>cached||fetch(event.request)));
    return;
  }
  if(url.pathname.startsWith('/static/')||url.pathname==='/design-system.css'){
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response})));
    return;
  }
});
