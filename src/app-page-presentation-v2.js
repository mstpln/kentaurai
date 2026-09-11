import {
  renderAppPage as renderFilteredAppPage,
  renderLoginPage,
  htmlResponse,
  redirectResponse,
  safeReturnPath
} from './app-page-trend.js';

export { renderLoginPage, htmlResponse, redirectResponse, safeReturnPath };

export const PRESENTATION_STANDARD_DISTANCE_GROUPS = [640, 1640, 2140, 2640, 3140, 3640, 4140];
export const PRESENTATION_OTHER_LONG_DISTANCE_GROUP = 'Övrigt >2640';
const PRESENTATION_DISTANCE_TOLERANCE_M = 100;

export function presentationDistanceGroup(value) {
  if (value === null || value === undefined || value === '' || value === 'unknown') return 'unknown';
  const distance = Number(value);
  if (!Number.isFinite(distance)) return String(value);
  for (const standard of PRESENTATION_STANDARD_DISTANCE_GROUPS) {
    if (Math.abs(distance - standard) <= PRESENTATION_DISTANCE_TOLERANCE_M) return String(standard);
  }
  if (distance > 2640) return PRESENTATION_OTHER_LONG_DISTANCE_GROUP;
  return String(Math.round(distance));
}

export function presentationGroupDistanceRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const label = presentationDistanceGroup(row.label);
    const existing = groups.get(label) || {
      label,
      starts: 0,
      resultStarts: 0,
      wins: 0,
      top3: 0,
      gallops: 0,
      disqualifications: 0,
      prizeSek: 0
    };
    existing.starts += Number(row.starts || 0);
    existing.resultStarts += Number(row.resultStarts || 0);
    existing.wins += Number(row.wins || 0);
    existing.top3 += Number(row.top3 || 0);
    existing.gallops += Number(row.gallops || 0);
    existing.disqualifications += Number(row.disqualifications || 0);
    existing.prizeSek += Number(row.prizeSek || 0);
    groups.set(label, existing);
  }
  const order = new Map(PRESENTATION_STANDARD_DISTANCE_GROUPS.map((value, index) => [String(value), index]));
  return [...groups.values()].map((row) => ({
    ...row,
    winRate: row.resultStarts ? row.wins / row.resultStarts : null,
    top3Rate: row.resultStarts ? row.top3 / row.resultStarts : null,
    gallopRate: row.resultStarts ? row.gallops / row.resultStarts : null
  })).sort((a, b) => {
    const ai = order.has(a.label) ? order.get(a.label) : a.label === PRESENTATION_OTHER_LONG_DISTANCE_GROUP ? 100 : a.label === 'unknown' ? 102 : 101;
    const bi = order.has(b.label) ? order.get(b.label) : b.label === PRESENTATION_OTHER_LONG_DISTANCE_GROUP ? 100 : b.label === 'unknown' ? 102 : 101;
    return ai - bi || String(a.label).localeCompare(String(b.label), 'sv');
  });
}

const presentationCss = `
<style id="kentaurai-presentation-v2">
.detail-profile{align-items:center!important}.detail-icon{border-radius:50%!important;background:#151412!important;border-color:#38342d!important;font-weight:650!important;color:var(--beige)!important}.detail-icon svg{display:none!important}.detail-icon .profile-initials{display:grid!important}.detail-profile-main{min-width:0}.detail-profile-main h1{white-space:normal!important;overflow-wrap:anywhere}.data-list dt,.data-list dd{overflow-wrap:anywhere}.data-section{min-width:0}.data-section-grid{min-width:0}
.start-details .data-section-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.start-details .data-list{grid-template-columns:minmax(80px,.8fr) minmax(0,1.2fr)!important}.start-details .data-list dd{text-align:right!important;min-width:0}.start-details .data-list dt{min-width:0}
@media(max-width:620px){.detail-profile{align-items:flex-start!important}.detail-icon{width:58px!important;height:58px!important;flex:0 0 58px!important}.detail-profile-main h1{font-size:20px!important}.detail-meta{font-size:11px!important}.start-details{overflow:hidden!important}.start-details .data-section-grid{grid-template-columns:1fr!important}.start-details .data-section{min-width:0!important}.start-details .data-list{grid-template-columns:minmax(72px,.9fr) minmax(0,1.1fr)!important}.start-details .data-list dt,.start-details .data-list dd{font-size:10px!important}.start-details .data-list dd{white-space:normal!important;overflow-wrap:anywhere!important}}
</style>`;

const presentationScript = `
<script id="kentaurai-presentation-v2-script">
(function(){
const PROFILE_TYPES={horses:'horse',trainers:'trainer',drivers:'driver'};
function profileInitials(name){return String(name||'').trim().split(/\\s+/).filter(Boolean).slice(0,2).map(part=>part.charAt(0)).join('').toUpperCase()||'?'}
const priorDetailHeader=detailHeader;
detailHeader=function(detail){const type=PROFILE_TYPES[state.detail&&state.detail.page]||'';const html=priorDetailHeader(detail);if(!type)return html;return html.replace(/<span class="detail-icon">[\\s\\S]*?<\\/span>/,'<span class="detail-icon"><span class="profile-initials">'+esc(profileInitials(detail.name))+'</span></span>')};
const STANDARD_DISTANCES=${JSON.stringify(PRESENTATION_STANDARD_DISTANCE_GROUPS)};
const OTHER_LONG=${JSON.stringify(PRESENTATION_OTHER_LONG_DISTANCE_GROUP)};
function presentationDistanceGroup(value){if(value==null||value===''||value==='unknown')return 'unknown';const distance=Number(value);if(!Number.isFinite(distance))return String(value);for(const standard of STANDARD_DISTANCES){if(Math.abs(distance-standard)<=100)return String(standard)}if(distance>2640)return OTHER_LONG;return String(Math.round(distance))}
groupDistanceRows=function(rows){const groups=new Map();for(const row of rows||[]){const label=presentationDistanceGroup(row.label);const existing=groups.get(label)||{label,starts:0,resultStarts:0,wins:0,top3:0,gallops:0,disqualifications:0,prizeSek:0};existing.starts+=Number(row.starts||0);existing.resultStarts+=Number(row.resultStarts||0);existing.wins+=Number(row.wins||0);existing.top3+=Number(row.top3||0);existing.gallops+=Number(row.gallops||0);existing.disqualifications+=Number(row.disqualifications||0);existing.prizeSek+=Number(row.prizeSek||0);groups.set(label,existing)}const order=new Map(STANDARD_DISTANCES.map((value,index)=>[String(value),index]));return [...groups.values()].map(row=>({...row,winRate:row.resultStarts?row.wins/row.resultStarts:null,top3Rate:row.resultStarts?row.top3/row.resultStarts:null,gallopRate:row.resultStarts?row.gallops/row.resultStarts:null})).sort((a,b)=>{const ai=order.has(a.label)?order.get(a.label):a.label===OTHER_LONG?100:a.label==='unknown'?102:101;const bi=order.has(b.label)?order.get(b.label):b.label===OTHER_LONG?100:b.label==='unknown'?102:101;return ai-bi||String(a.label).localeCompare(String(b.label),'sv')})};
})();
</script>`;

export function renderAppPage() {
  return renderFilteredAppPage()
    .replace('</head>', `${presentationCss}</head>`)
    .replace('</body>', `${presentationScript}</body>`);
}
