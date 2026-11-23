/* CrewCamp service worker: installable app + offline fallback.
   Network-first for pages/scripts/styles (everyone always gets the newest version), cache only as a fallback.
   /api/* is never cached or intercepted. Bump V to drop old caches. */
const V = 'cc-v1', SHELL = ['login.html', 'logo.svg', 'icon-192.png', 'style.css', 'icons.js', 'auth.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('login.html') : Response.error()))));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const to = (e.notification.data && e.notification.data.url) || 'cross.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs[0]; if (c) { c.focus(); return; }
    return self.clients.openWindow(to);
  }));
});
