/* 靜態檔快取：重複開啟時網頁本體與背景圖直接從本機載入（先顯示舊版，背景悄悄更新，下次開啟即是新版）
   訊號資料不在這裡：GAS API 與 Google Fonts 是跨網域，不經過這個快取，訊號改存在 IndexedDB */
const CACHE = 'radar-v2';
const ASSETS = ['./', 'index.html', 'bg-light.jpg', 'bg-dark.jpg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
