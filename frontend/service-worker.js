const CACHE='awun-shell-1.8.0';
const SHELL=['/','/static/styles.css?v=20260718.1','/static/app.js?v=20260718.1','/static/flow.js?v=20260718.1','/static/brand/awun-icon-black.png','/static/brand/awun-icon-white.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).pathname.startsWith('/api/'))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok&&new URL(event.request.url).origin===location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>caches.match(event.request).then(response=>response||caches.match('/'))));
});
