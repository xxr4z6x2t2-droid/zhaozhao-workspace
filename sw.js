// 昭朝工作台 Service Worker — PWA 离线缓存（v7）
// 策略：网络优先 + 失败回退缓存（代码更新立即生效，离线可用）
// 注意：本站部署在 GitHub Pages 子路径 /zhaozhao-workspace/ 下，
//       cache.addAll 的相对路径会以 sw.js 所在目录解析，必须用 ./ 相对路径。
const CACHE_NAME = 'zhaozhao-workspace-v7';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './diary.js',
  './sync.js',
  './favicon.jpg',
  './manifest.json',
  './hotspots.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(ASSETS.map(a => cache.add(a))))
      // allSettled：单个资源失败不阻塞安装（网络优先策略下缓存只是离线兜底）
      .then(() => self.skipWaiting())
  );
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
  // API/跨域请求不拦截
  if (!url.startsWith(self.location.origin)) return;
  // 带 ?t= 时间戳的资源（hotspots.json 等）始终走网络
  if (url.includes('?t=') || url.includes('?v=')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // 其余同源资源：网络优先，失败回退缓存
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
