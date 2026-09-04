// ★HTML/JS/CSS(앱 화면 코드)는 절대 캐시하지 않는다.
//   테리 지적(2026-08-23): 앱이 최신인데 옛 화면이 뜨는 원인 = 앱 코드 안의 SW 캐시(PC 캐시 아님).
//   예전엔 "/","/index.html"을 캐시에 넣고 CACHE 이름이 v1 고정이라, 업데이트해도 옛 화면이 남았다.
const CACHE = "publy-runtime";

self.addEventListener("install", () => {
  self.skipWaiting();   // 새 SW 즉시 활성화(업데이트 대기 안 함)
});

self.addEventListener("activate", e => {
  // 옛 버전 캐시 전부 삭제 후 즉시 제어권 획득
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  // HTML·JS·CSS·네비게이션은 무조건 네트워크에서 최신으로(캐시 저장 안 함) → 옛 화면 잔존 원천 차단
  if (e.request.mode === "navigate" || /\.(html|js|css)(\?|$)/i.test(url)) {
    e.respondWith(fetch(e.request));
    return;
  }
  // 그 외(이미지 등)는 네트워크 우선, 실패 시에만 캐시 폴백
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
