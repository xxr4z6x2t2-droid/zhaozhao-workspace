// 昭朝工作台 Service Worker — PWA 离线缓存
const CACHE_NAME = 'zhaozhao-workspace-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // API 请求走网络
  if (url.includes('/api/')) return;
  // 带 ?t= 时间戳的资源（hotspots.json 等）始终走网络
  if (url.includes('?t=')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // 其余资源：网络优先，失败回退缓存（避免代码更新后仍命中旧缓存）
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(c => c || new Response('离线', { status: 503 })))
  );
});
