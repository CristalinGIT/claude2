// Кэш для работы без интернета: после первого открытия игра грузится из памяти телефона.
const VERSION = 'tankhaos-v12';
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/main.js',
  'js/game.js',
  'js/map.js',
  'js/bot.js',
  'js/net.js',
  'js/input.js',
  'js/render.js',
  'js/sound.js',
  'js/cards.js',
  'js/layout.js',
  'vendor/three.module.min.js',
  'vendor/peerjs.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Сначала сеть (чтобы обновления доходили), при её отсутствии — кэш.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: всегда сверяемся с сервером, чтобы обновления доходили сразу.
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
