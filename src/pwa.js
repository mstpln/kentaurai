const THEME = '#0b0b0a';
const ACCENT = '#C79552';
const SAGITTARIUS_PATH = 'M267.934 459.625l-80.013-80.08-100.315 100.12-57.517-57.516 100.25-100.252c-60.47-60.56-77.15-77.326-79.827-80.078l57.52-57.522 79.95 79.952 128.03-128.028C178.14 101.764 209.1 109.4 204.28 108.128L223.96 29.2l203.814 50.813L477.8 283.637l-79.192 19.745-26.762-107.595-126.212 126.106 80.02 80.018-57.72 57.715z';

export function pwaManifest() {
  return {
    id: '/app/',
    name: 'KentaurAI',
    short_name: 'KentaurAI',
    description: 'Privat V85/V86 travintelligens.',
    lang: 'sv',
    start_url: '/app/',
    scope: '/app/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: THEME,
    theme_color: THEME,
    icons: [
      { src: '/app/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/app/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
    ]
  };
}

export function pwaIcon({ maskable = false } = {}) {
  const inset = maskable ? 82 : 54;
  const radius = maskable ? 0 : 112;
  const ringRadius = 204 - (maskable ? 24 : 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="KentaurAI"><rect width="512" height="512" rx="${radius}" fill="${THEME}"/><circle cx="256" cy="256" r="${ringRadius}" fill="none" stroke="${ACCENT}" stroke-width="20"/><g transform="translate(${inset} ${inset}) scale(${(512 - inset * 2) / 512})"><path d="${SAGITTARIUS_PATH}" fill="${ACCENT}"/></g></svg>`;
}

export function pwaServiceWorker() {
  return `const CACHE='kentaurai-pwa-v1';
const STATIC=new Set(['/app/manifest.webmanifest','/app/icon.svg','/app/icon-maskable.svg']);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...STATIC])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!STATIC.has(url.pathname))return;event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}))) });`;
}

export function pwaHeadMarkup() {
  return `<link rel="manifest" href="/app/manifest.webmanifest"><link rel="icon" href="/app/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/app/icon.svg"><meta name="application-name" content="KentaurAI"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="KentaurAI">`;
}

export function pwaRegistrationScript() {
  return `<script id="kentaurai-pwa-registration">if('serviceWorker'in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/app/sw.js',{scope:'/app/'}).catch(()=>{})})}</script>`;
}
