// 앱 셸 캐시: 네트워크 우선(항상 최신 배포 반영) → 오프라인일 때만 캐시 사용. 사진 데이터는 저장/전송하지 않음.
const CACHE = 'skin-tester-v6';
const SHELL = ['./', 'style.css?v=6', 'app.js?v=6', 'analyze.js?v=6', 'manifest.webmanifest', 'logo.svg', 'icons/icon-192.png', 'icons/favicon-32.png', 'icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== location.origin) return;
  const isNav = r.mode === 'navigate';
  // 페이지(HTML)는 HTTP 캐시를 우회해 서버에 재검증 → 새 배포가 바로 반영됨
  const req = isNav ? new Request(r.url, { cache: 'no-cache', credentials: 'same-origin' }) : r;
  const key = isNav ? './' : r;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((m) => m || (isNav ? caches.match('./') : Response.error()))));
});
