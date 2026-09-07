import {
  renderAppPage as renderCompleteAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-complete.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

const logoutMarkup = '    <form method="post" action="/app/logout"><button class="logout" type="submit">Logga ut</button></form>\n';
const featureProvenanceMarkup = "+(f.provenance?'<pre class=\"json-block\">'+esc(jsonText(f.provenance))+'</pre>':'')";

export function renderAppPage() {
  return renderCompleteAppPage()
    .replace(logoutMarkup, '')
    .replace(featureProvenanceMarkup, '');
}
