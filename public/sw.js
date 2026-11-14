// Wasteless · работа без сети. Сначала сеть, при её отсутствии — кэш.
// Оболочка приложения и справочники (виды отходов, способы, продукты, мой отчёт) доступны офлайн;
// новые записи без сети складываются в очередь на телефоне (app.js) и уходят на сервер, когда сеть появится.
const CACHE = 'wasteless-v5';
const SHELL = ['/app', '/app.js', '/styles.css', '/vendor/chart.js', '/vendor/anime.min.js', '/icon.svg', '/icon-192.png', '/manifest.json'];
const API_CACHE = /^\/api\/(me|config|info|waste-types|methods|products|my-report|my-summary|orgs|goals\/me|rating)(\?|$)/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isApi = url.pathname.startsWith('/api/');
  if (isApi && !API_CACHE.test(url.pathname + url.search)) return;
  const isNav = req.mode === 'navigate' && url.pathname.startsWith('/app');
  e.respondWith((async () => {
    try {
      // статика — с перепроверкой ETag, чтобы обновления доходили сразу (navigate-запрос нельзя переиспользовать с init — берём адрес)
      const res = isApi ? await fetch(req) : await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok && (isApi || isNav || SHELL.includes(url.pathname) || url.pathname.startsWith('/vendor/'))) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(isNav ? '/app' : req, copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(isNav ? '/app' : req);
      if (hit) return hit;
      if (isApi) return new Response(JSON.stringify({ error: 'Нет сети', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      throw err;
    }
  })());
});
