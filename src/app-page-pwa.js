import {
  renderAppPage as renderHistoryAppPage,
  renderLoginPage as renderHistoryLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-history.js';
import { pwaHeadMarkup, pwaRegistrationScript } from './pwa.js';

export { htmlResponse, redirectResponse, safeReturnPath };

function addPwaHead(html) {
  return html.replace('</head>', `${pwaHeadMarkup()}</head>`);
}

export function renderLoginPage(options = {}) {
  return addPwaHead(renderHistoryLoginPage(options));
}

export function renderAppPage() {
  return addPwaHead(renderHistoryAppPage()).replace('</body>', `${pwaRegistrationScript()}</body>`);
}
