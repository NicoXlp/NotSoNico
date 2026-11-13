// Service Worker: Offline-Cache + Push-Mitteilungen für die Müll-Erinnerungen
const CACHE = 'vermietertagebuch-v11';
const ASSETS = [
  './', './index.html', './css/style.css', './js/app.js', './js/store.js', './js/ics.js', './js/config.js', './js/trash-logic.js', './js/media.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Netzwerk zuerst (damit Updates sofort ankommen), Cache als Rückfall für offline
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});

// Push vom Server (scripts/send-reminders.mjs)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Vermietertagebuch', body: e.data?.text() }; }
  const actions = d.bin ? [{ action: 'done', title: '✓ Rausgestellt' }] : [];
  e.waitUntil(self.registration.showNotification(d.title || 'Vermietertagebuch', {
    body: d.body || '',
    tag: d.tag,
    renotify: !!d.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: d.url || './?tab=trash', bin: d.bin, date: d.date },
    actions,
  }));
});

// Klick auf die Mitteilung oder auf „✓ Rausgestellt“
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { bin, date } = e.notification.data || {};
  const done = e.action === 'done' && bin && date;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all[0];
    if (client) {
      await client.focus().catch(() => {});
      client.postMessage(done ? { type: 'bin-done', bin, date } : { type: 'open-tab', tab: 'trash' });
      return;
    }
    const url = new URL('./', self.registration.scope);
    url.searchParams.set('tab', 'trash');
    if (done) url.searchParams.set('done', `${bin}:${date}`);
    await self.clients.openWindow(url.href);
  })());
});
