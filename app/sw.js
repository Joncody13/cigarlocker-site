// Cigar Locker on the web (cigarlocker.app/app): its service worker, put
// beside the app by scripts/build-web.cjs.
//
// - The app's database (expo-sqlite in a browser) needs SharedArrayBuffer,
//   which a browser gives only to a page that is cross-origin isolated, and
//   GitHub Pages cannot send the two headers that make a page so. This adds
//   them to every page and file of the app. Safari knows only the strict kind
//   ("require-corp"), the others the kind that still shows pictures from other
//   sites ("credentialless").
// - Photos taken or chosen in the web version are kept in Cache Storage
//   ("cigar-photos", src/photos/store.web.ts) and answered from there.
// - Any other address under /app/ (a cigar's page, /app/lot/...) answers with
//   the app's own page, which reads the address.

const BASE = '/app/';
const PHOTOS = 'cigar-photos';
const UA = self.navigator.userAgent;
const COEP = /AppleWebKit/.test(UA) && !/Chrome\/|Chromium\//.test(UA) ? 'require-corp' : 'credentialless';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  // A page loaded past this worker (a hard reload) asks to be taken in.
  if (event.data && event.data.type === 'claim') event.waitUntil(self.clients.claim());
});

function isolated(res) {
  if (res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', COEP);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Under Safari's strict kind a picture from another site shows only if
    // that site says it may: ask it that way first, else as the page would.
    if (COEP === 'require-corp' && req.destination === 'image') {
      event.respondWith(fetch(req.url, { mode: 'cors', credentials: 'omit' }).catch(() => fetch(req)));
    }
    return;
  }
  if (!url.pathname.startsWith(BASE)) return;
  if (url.pathname.startsWith(BASE + 'photos/')) {
    event.respondWith(
      caches
        .open(PHOTOS)
        .then((cache) => cache.match(url.pathname))
        .then((hit) => (hit ? isolated(hit) : new Response('', { status: 404 }))),
    );
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => (res.status === 404 ? fetch(BASE) : res))
        .then(isolated),
    );
    return;
  }
  event.respondWith(fetch(req).then(isolated));
});
