import {
  renderAppPage as renderAlignedAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-aligned.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

export function formatTrackAddress(detail) {
  const street = String(detail?.address?.street || '').trim();
  const postal = String(detail?.address?.postalCode || '').trim();
  const city = String(detail?.city || '').trim();
  if (!street && !postal) return '';

  const normalize = (value) => String(value || '').trim().toLocaleLowerCase('sv-SE').replace(/\s+/g, ' ');
  const duplicateParts = new Set([
    normalize(postal),
    normalize(city),
    normalize([postal, city].filter(Boolean).join(' '))
  ].filter(Boolean));
  const streetParts = street.split(',').map((part) => part.trim()).filter(Boolean);
  const cleanStreet = streetParts.filter((part) => !duplicateParts.has(normalize(part))).join(', ');
  const tail = [postal, city].filter(Boolean).join(' ');

  if (!cleanStreet) return tail;
  if (!tail || normalize(cleanStreet).includes(normalize(tail))) return cleanStreet;
  return [cleanStreet, tail].filter(Boolean).join(', ');
}

function replaceOnce(html, before, after) {
  return html.includes(before) ? html.replace(before, after) : html;
}

export function applyStatScopePolish(html) {
  let result = String(html);

  result = replaceOnce(
    result,
    "state.trackFilters[key]={year:'all',startMethod:'auto',distanceGroup:",
    "state.trackFilters[key]={year:'all',startMethod:'all',raceScope:'all',distanceGroup:"
  );
  result = replaceOnce(
    result,
    "state.trackFilters[key].stlClass=state.trackFilters[key].stlClass||'all';state.trackFilters[key].raceType=state.trackFilters[key].raceType||'all'",
    "state.trackFilters[key].stlClass=state.trackFilters[key].stlClass||'all';state.trackFilters[key].raceType=state.trackFilters[key].raceType||'all';state.trackFilters[key].raceScope=state.trackFilters[key].raceScope||'all'"
  );
  result = replaceOnce(
    result,
    "trackFilterButtons([['auto','Autostart'],['volt','Voltstart']],f.startMethod,'data-track-method')",
    "trackFilterButtons([['all','All data'],['auto','Autostart'],['volt','Voltstart']],f.startMethod,'data-track-method')"
  );
  result = replaceOnce(
    result,
    "+'</div></div><div class=\"filter-block\"><div class=\"filter-label\">Distans</div>'+trackFilterButtons(groups.length?groups:[[f.distanceGroup,f.distanceGroup]],f.distanceGroup,'data-track-distance')+",
    "+'</div></div><div class=\"filter-block\"><div class=\"filter-label\">Loppnivå</div>'+trackFilterButtons([['all','All data'],['stl','STL-lopp'],['weekday','Vardagstrav']],f.raceScope,'data-track-race-scope')+'</div><div class=\"filter-block\"><div class=\"filter-label\">Distans</div>'+trackFilterButtons(groups.length?groups:[[f.distanceGroup,f.distanceGroup]],f.distanceGroup,'data-track-distance')+"
  );
  result = replaceOnce(
    result,
    "new URLSearchParams({year:f.year,start_method:f.startMethod,distance_group:f.distanceGroup})",
    "new URLSearchParams({year:f.year,race_scope:f.raceScope,start_method:f.startMethod,distance_group:f.distanceGroup})"
  );
  result = replaceOnce(
    result,
    "document.querySelectorAll('[data-track-method]').forEach(b=>b.onclick=()=>{f.startMethod=b.dataset.trackMethod;trackLaneView(detail)});document.querySelectorAll('[data-track-distance]')",
    "document.querySelectorAll('[data-track-method]').forEach(b=>b.onclick=()=>{f.startMethod=b.dataset.trackMethod;trackLaneView(detail)});document.querySelectorAll('[data-track-race-scope]').forEach(b=>b.onclick=()=>{f.raceScope=b.dataset.trackRaceScope;trackLaneView(detail)});document.querySelectorAll('[data-track-distance]')"
  );

  const oldAddress = "function formatTrackAddress(detail){const street=String(detail.address?.street||'').trim(),postal=String(detail.address?.postalCode||'').trim(),city=String(detail.city||'').trim();if(!street&&!postal)return '';const tail=[postal,city].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' ');if(!street)return tail;if(!tail||street.toLowerCase().includes(tail.toLowerCase()))return street;return street+', '+tail}";
  result = replaceOnce(result, oldAddress, formatTrackAddress.toString());

  return result;
}

export function renderAppPage() {
  return applyStatScopePolish(renderAlignedAppPage());
}
