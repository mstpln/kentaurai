import assets from './assets/travdata.json' with { type: 'json' };
import { travdataThemeCss } from './travdata-theme.js';
import { pwaManifest, pwaServiceWorker } from './pwa.js';

const logoMarkup = '<div class="brand travdata-brand"><img class="travdata-logo-mark" src="/app/brand/td-mark.png" width="30" height="30" alt=""><span class="travdata-wordmark" role="img" aria-label="Travdata"><span class="travdata-word-trav">TRAV</span><span class="travdata-word-data">DATA</span></span></div>';
const originalBrand = /<div class="brand"><span class="brand-badge">[\s\S]*?<\/span><div class="brand-name">KENTAUR<span>AI<\/span><\/div><\/div>/g;

/** Display-only transformation. API/storage names and existing icons are untouched. */
export function enhanceTravdataHtml(html) {
  if (typeof html !== 'string' || html.includes('id="travdata-brand-theme"')) return html;
  return html
    .replace(originalBrand, logoMarkup)
    .replaceAll('KentaurAI', 'Travdata')
    .replace('<link rel="manifest" href="/app/manifest.webmanifest">', '<link rel="manifest" href="/app/manifest.webmanifest?brand=travdata-1">')
    .replace('<link rel="icon" href="/app/icon.svg" type="image/svg+xml">', '<link rel="icon" href="/app/icon.svg?brand=travdata-1" type="image/svg+xml"><link rel="apple-touch-icon" sizes="512x512" href="/app/apple-touch-icon.png?brand=travdata-1">')
    .replace(/(<meta name="color-scheme" content=")[^"]*(")/g, '$1light$2')
    .replace(/(<meta name="theme-color" content=")[^"]*(")/g, '$1#010127$2')
    .replace(/(<meta name="apple-mobile-web-app-status-bar-style" content=")[^"]*(")/g, '$1default$2')
    .replace('</head>', `${travdataThemeCss}</head>`);
}

function staticResponse(body, type, cache = 'no-cache') {
  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': cache,
      'x-content-type-options': 'nosniff'
    }
  });
}

function imageBytes(base64) {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

export function travdataManifest() {
  return {
    ...pwaManifest(),
    name: 'Travdata',
    short_name: 'Travdata',
    description: 'Travstatistik, hästanteckningar och egna V85/V86-system.',
    icons: [
      { src: '/app/icon.png?brand=travdata-1', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-maskable.svg?brand=travdata-1', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
    ],
    background_color: '#F7F7FC',
    theme_color: '#010127'
  };
}

/** Public visual assets only: no credentials, bindings, database or API changes. */
export function travdataAssetResponse(request) {
  if (request.method !== 'GET') return null;
  const path = new URL(request.url).pathname;
  if (['/app/brand/td-mark.png', '/app/icon.png', '/app/apple-touch-icon.png'].includes(path)) {
    return staticResponse(imageBytes(assets.iconPng), 'image/png');
  }
  if (path === '/app/manifest.webmanifest') {
    return staticResponse(JSON.stringify(travdataManifest()), 'application/manifest+json; charset=utf-8');
  }
  if (path === '/app/icon.svg' || path === '/app/icon-maskable.svg') {
    const maskable = path.includes('maskable');
    const inset = maskable ? 52 : 0;
    const size = 512 - inset * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Travdata"><rect width="512" height="512" fill="#F7F7FC"/><image x="${inset}" y="${inset}" width="${size}" height="${size}" href="data:image/png;base64,${assets.iconPng}"/></svg>`;
    return staticResponse(svg, 'image/svg+xml; charset=utf-8');
  }
  if (path === '/app/sw.js') {
    // Refresh only the existing PWA static cache. Notes/systems/auth are unchanged.
    const response = staticResponse(pwaServiceWorker()
      .replace('kentaurai-pwa-v1', 'kentaurai-pwa-v3')
      .replace("'/app/icon-maskable.svg'", "'/app/icon-maskable.svg','/app/icon.png','/app/apple-touch-icon.png'")
      .replace('cache.addAll([...STATIC])', "cache.addAll([...STATIC].map(path=>path+'?brand=travdata-1'))"), 'text/javascript; charset=utf-8');
    response.headers.set('service-worker-allowed', '/app/');
    return response;
  }
  return null;
}
