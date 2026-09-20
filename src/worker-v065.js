import worker from './worker-v064.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import { createDataCoverageExportResponse } from './data-coverage-v2.js';
import { getHorseFilterOptions } from './statistics/horses-complete.js';
import {
  getCalendarYearDetailSpecialties,
  getDriverCalendarYearDetailStatistics,
  getHorseCalendarYearDetailStatistics,
  getTrainerCalendarYearDetailStatistics
} from './entity-detail-calendar-statistics.js';
import { getTrainerCalendarHomeTrackResults } from './trainer-calendar-home-statistics.js';

const dataCoverageUiStyle = `
<style id="kentaurai-data-coverage-ui-style">
.data-coverage-card .settings-card-body{display:grid;gap:10px}.data-coverage-card .settings-help{margin-top:0;max-width:720px}
</style>`;

const dataCoverageUiScript = `
<script id="kentaurai-data-coverage-ui-script">
(function(){
function addCoverageCard(){
  const layout=document.querySelector('.settings-layout');
  if(!layout||document.getElementById('dataCoverageAuditCard')||document.getElementById('exportProvider'))return;
  const headings=[...layout.querySelectorAll('.settings-card-head h2')].map(node=>node.textContent.trim());
  if(!headings.includes('Datamängd'))return;
  const section=document.createElement('section');
  section.className='settings-section settings-card data-coverage-card';
  section.id='dataCoverageAuditCard';
  section.innerHTML='<div class="settings-card-head"><h2>Datatäckning</h2><p>Skapa en aggregerad rapport över vad KentaurAI faktiskt har lagrat i databasen.</p></div><div class="settings-card-body"><div class="settings-actions"><button class="settings-secondary" id="downloadDataCoverage" type="button">Hämta datatäckningsrapport</button></div><div class="settings-help">Rapporten innehåller endast aggregerade täckningsmått och inga radvisa namn, interna ID:n, URL:er, rådata eller redaktionell proveniens.</div></div>';
  const footer=layout.querySelector('.settings-footer');
  if(footer)layout.insertBefore(section,footer);else layout.appendChild(section);
  document.getElementById('downloadDataCoverage').onclick=()=>{window.location.href='/app/api/settings/data-coverage'};
}
let pending=false;
function scheduleCoverageCard(){
  if(pending)return;
  pending=true;
  queueMicrotask(()=>{pending=false;addCoverageCard()});
}
const app=document.getElementById('app');
if(app)new MutationObserver(scheduleCoverageCard).observe(app,{childList:true,subtree:true});
document.addEventListener('click',event=>{if(event.target.closest('.tab[data-tab="data"],#settingsButton'))setTimeout(addCoverageCard,0)});
addCoverageCard();
})();
</script>`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function requireSession(request, env) {
  if (!appAuthConfigured(env)) return json({ error: 'service_unavailable' }, 503);
  if (!(await hasValidAppSession(request, env))) return json({ error: 'unauthorized' }, 401);
  return null;
}

function canonicalAppRedirect(request, url) {
  if (request.method !== 'GET' || url.pathname !== '/app') return null;
  const target = new URL(url.toString());
  target.pathname = '/app/';
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store'
    }
  });
}

function calendarOptions(url) {
  return {
    year: url.searchParams.get('year'),
    raceScope: url.searchParams.get('race_scope'),
    trackId: url.searchParams.get('track_id'),
    raceType: url.searchParams.get('race_type'),
    breedType: url.searchParams.get('breed_type'),
    sex: url.searchParams.get('sex'),
    age: url.searchParams.get('age'),
    startMethod: url.searchParams.get('start_method'),
    distanceGroup: url.searchParams.get('distance_group'),
    voltLane: url.searchParams.get('volt_lane'),
    handicapM: url.searchParams.get('handicap_m')
  };
}

function enhanceDataCoverageDownloadHtml(html) {
  if (typeof html !== 'string' || html.includes('kentaurai-data-coverage-ui-script')) return html;
  return html
    .replace('</head>', `${dataCoverageUiStyle}</head>`)
    .replace('</body>', `${dataCoverageUiScript}</body>`);
}

async function enhancedAppResponse(request, response) {
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET' || path !== '/app/') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const body = enhanceDataCoverageDownloadHtml(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

const calendarHandlers = {
  trainers: getTrainerCalendarYearDetailStatistics,
  drivers: getDriverCalendarYearDetailStatistics,
  horses: getHorseCalendarYearDetailStatistics
};

async function calendarDetail(env, entityType, entityId, options) {
  const data = await calendarHandlers[entityType](env, entityId, options);
  if (!data || entityType !== 'trainers' || options.includeSpecials === false) return data;
  const home = await getTrainerCalendarHomeTrackResults(env, entityId, data.filters);
  return { ...data, ...home };
}

async function calendarSpecialties(env, entityType, entityId, options) {
  const data = await getCalendarYearDetailSpecialties(env, entityType, entityId, options);
  if (!data || entityType !== 'trainers') return data;
  const home = await getTrainerCalendarHomeTrackResults(env, entityId, data.filters);
  return { ...data, ...home };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const canonical = canonicalAppRedirect(request, url);
    if (canonical) return canonical;

    if (request.method === 'GET' && path === '/app/api/settings/data-coverage') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try { return await createDataCoverageExportResponse(env); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    if (request.method === 'GET' && path === '/app/api/horses/statistics/filter-options') {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try { return json(await getHorseFilterOptions(env)); }
      catch (error) { console.error(error); return json({ error: 'request_failed', message: error.message }, 400); }
    }

    const calendarSpecialtiesMatch = path.match(/^\/app\/api\/(trainers|drivers|horses)\/([^/]+)\/calendar-specialties$/);
    if (request.method === 'GET' && calendarSpecialtiesMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const entityType = calendarSpecialtiesMatch[1];
        const data = await calendarSpecialties(env, entityType, decodeURIComponent(calendarSpecialtiesMatch[2]), calendarOptions(url));
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    const calendarMatch = path.match(/^\/app\/api\/(trainers|drivers|horses)\/([^/]+)\/calendar-statistics$/);
    if (request.method === 'GET' && calendarMatch) {
      const denied = await requireSession(request, env);
      if (denied) return denied;
      try {
        const entityType = calendarMatch[1];
        const options = calendarOptions(url);
        options.includeSpecials = url.searchParams.get('specials') !== '0';
        const data = await calendarDetail(env, entityType, decodeURIComponent(calendarMatch[2]), options);
        return data ? json(data) : json({ error: 'not_found' }, 404);
      } catch (error) {
        console.error(error);
        return json({ error: 'request_failed', message: error.message }, 400);
      }
    }

    return enhancedAppResponse(request, await worker.fetch(request, env, ctx));
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};
