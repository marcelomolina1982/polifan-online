const SW_VERSION='15.5'
self.addEventListener('install',event=>{self.skipWaiting()})
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(key=>caches.delete(key)));await self.clients.claim()})())})
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return
  const request=new Request(event.request,{cache:'no-store'})
  event.respondWith(fetch(request).catch(()=>caches.match(event.request)))
})
