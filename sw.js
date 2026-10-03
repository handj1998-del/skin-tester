// 앱 셸 캐시 (네트워크 우선 → 오프라인 시 캐시). 사진 데이터는 절대 저장/전송하지 않음.
const CACHE = 'skin-tester-v4';
const SHELL = ['./', 'index.html', 'style.css?v=4', 'app.js?v=4', 'analyze.js?v=4', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon-32.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); return res; }).catch(() => caches.match(r).then((m) => m || caches.match('./'))));
});
