/* Zenkai – Service Worker: App offline verfügbar machen.
   Bei Änderungen an der App VERSION erhöhen, damit Geräte die neue Version laden. */
const VERSION = 'zenkai-v17';
const FILES = ['./', 'index.html', 'css/style.css', 'js/config.js', 'js/store.js', 'js/sync.js', 'js/images.js', 'js/reports.js', 'js/ai.js', 'js/speech.js', 'js/app.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // KI-Anfragen nie cachen
  // Netzwerk zuerst (immer aktuell), offline aus dem Cache
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
