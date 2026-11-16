// Guarda o app no celular para funcionar sem internet. Sempre tenta a versão nova primeiro.
const CACHE = 'sfx-studio-v4';
const ASSETS = ['./', 'index.html', 'style.css?v=4', 'app.js?v=4', 'dsp.js', 'manifest.json', 'icon.svg',
  'vendor/lame.min.js', 'vendor/OggVorbisEncoder.min.js', 'vendor/OggVorbisEncoder.min.js.mem'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 4000))]);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      return (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
