// 앱 셸 캐시: 네트워크 우선(항상 최신 배포 반영) → 오프라인일 때만 캐시 사용. 사진 데이터는 저장/전송하지 않음.
// 버전은 app.js의 APP_VERSION이 등록 URL(sw.js?v=...)로 전달됨
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'skin-tester-' + VERSION;
// 얼굴 분석 도구(face/)는 용량이 커서 별도 캐시에 캐시 우선으로 보관 — 앱 버전이 바뀌어도 다시 받지 않음
const FACE_CACHE = 'how-face-mp101';
const SHELL = ['./', 'style.css?v=' + VERSION, 'app.js?v=' + VERSION, 'analyze.js?v=' + VERSION, 'recommend.js?v=' + VERSION, 'manifest.webmanifest', 'logo.svg', 'icons/icon-192.png', 'icons/favicon-32.png', 'icons/icon.svg', 'icons/favicon.svg', 'fonts/cg300.woff2', 'fonts/cg500.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== FACE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // 버전 확인은 항상 네트워크
  if (/\/face\/(vision_|face_landmarker)/.test(url.pathname)) { // 변하지 않는 대용량 런타임·모델만
    e.respondWith(caches.open(FACE_CACHE).then((c) => c.match(r, { ignoreSearch: true }).then((m) => m || fetch(r).then((res) => { if (res.ok && res.type === 'basic') c.put(r, res.clone()); return res; }))));
    return;
  }
  const isNav = r.mode === 'navigate';
  // 페이지(HTML)는 HTTP 캐시를 우회해 서버에 재검증 → 새 배포가 바로 반영됨
  const req = isNav ? new Request(r.url, { cache: 'no-cache', credentials: 'same-origin' }) : r;
  const key = isNav ? './' : r;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((m) => m || (isNav ? caches.match('./') : Response.error()))));
});
