import { enhanceEntityDetailStatisticsHtmlV2 } from './entity-detail-statistics-ui-v2.js';

const SUCCESS_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';bind(host,s,c)";
const ORDERED_RENDER = "host.innerHTML=content(data,s,c)+'<div class=\"entity-detail-controls\">'+toolbar(s,c)+panel(s,c)+'</div>';const scoreNode=host.querySelector('.entity-detail-score');const controlsNode=host.querySelector('.entity-detail-controls');if(scoreNode&&controlsNode)scoreNode.after(controlsNode);bind(host,s,c)";
const TRAINER_SPECIALS = "if(c.market)specials+=special('Resultat som favorit',data.favoriteResults,'Marknadsrank 1 vid sista giltiga snapshot före spelstopp')+special('Resultat som skräll',data.longshotResults,'Marknadsandel ≤ '+num(data.definitions?.longshotPercentMax??5)+'% vid spelstopp');return score(data,c)";
const TRAINER_SPECIALS_WITH_HOME = "if(s.page==='trainers')specials+=special('Hemmabana',data.homeTrackResults,'Senaste verifierade officiella hemmabana')+special('Övriga banor',data.otherTrackResults,'Endast tränare med verifierad hemmabana');if(c.market)specials+=special('Resultat som favorit',data.favoriteResults,'Marknadsrank 1 vid sista giltiga snapshot före spelstopp')+special('Resultat som skräll',data.longshotResults,'Marknadsandel ≤ '+num(data.definitions?.longshotPercentMax??5)+'% vid spelstopp');return score(data,c)";
const HORSE_AGE_OPTIONS = "if(!values.length&&s.options?.birthYears?.length){const y=new Date().getFullYear();values=[...new Set(s.options.birthYears.map(v=>y-Number(v)).filter(v=>v>=2&&v<=30))].sort((a,b)=>a-b)}";
const HORSE_AGE_OPTIONS_FOR_YEAR = "if(!values.length&&s.options?.birthYears?.length){const y=Number(s.filters.year)||new Date().getFullYear();values=[...new Set(s.options.birthYears.map(v=>y-Number(v)).filter(v=>v>=2&&v<=30))].sort((a,b)=>a-b)}";
const LEGACY_CLEANUP = "function cleanup(page,s){document.getElementById('trainerDetailStatisticsV2')?.remove();document.getElementById('trainerStatsBuildD')?.remove();document.getElementById('driverStatsBuildC')?.remove();if(page==='horses'){captureHorseExtra(s);document.getElementById('horseStatsBuildB')?.remove()}if(page==='trainers')document.querySelector('.entity-stat-filter-shell')?.remove();if(page==='drivers'){document.querySelector('.grid.grid-3')?.remove();document.querySelector('.breakdown-grid.stat-section')?.remove()}}";
const COMPLETE_CLEANUP = "function cleanup(page,s){document.getElementById('trainerDetailStatisticsV2')?.remove();document.getElementById('trainerStatsBuildD')?.remove();document.getElementById('driverStatsBuildC')?.remove();if(page==='horses'){captureHorseExtra(s);document.getElementById('horseStatsBuildB')?.remove()}if(page==='trainers')document.querySelector('.entity-stat-filter-shell')?.remove();if(page==='drivers'){document.querySelector('.grid.grid-3')?.remove();document.querySelector('.breakdown-grid.stat-section')?.remove()}app.querySelector(':scope > .data-groups')?.remove()}";


const externalEvidenceCss = '<style id="kentaurai-external-evidence-ui-style">' +
'.external-evidence-groups,.external-interview-list{display:grid;gap:14px}.external-evidence-section{overflow:hidden}.external-evidence-table-wrap{overflow-x:auto}.external-evidence-table{width:100%;border-collapse:collapse}.external-evidence-table th,.external-evidence-table td{padding:10px 12px;border-bottom:1px solid var(--line-soft);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.external-evidence-table th:first-child,.external-evidence-table td:first-child{text-align:left}.external-evidence-table th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:#10100f}.external-evidence-table td{font-size:12px}.external-evidence-table tr:last-child td{border-bottom:0}.external-interview-card{overflow:hidden}.external-interview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.external-interview-head>span{font-size:10px;color:var(--muted);white-space:nowrap}.external-interview-horse{font-size:10px;color:var(--accent-soft);margin-bottom:2px}.external-interview-summary{font-size:12px;line-height:1.55;color:#c7c0b6;margin-top:10px}.external-signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.external-signal{border:1px solid var(--line-soft);border-radius:9px;padding:9px 10px;font-size:11px;line-height:1.45}.external-signal-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}.external-signal-head span{font-size:9px;color:var(--muted)}.external-signal-evidence{margin-top:4px;color:var(--muted);font-size:10px}' +
'@media(max-width:620px){.external-signal-grid{grid-template-columns:1fr}.external-evidence-table th,.external-evidence-table td{padding:9px 7px;font-size:9px}.external-evidence-table th{font-size:7px}}' +
'</style>';

function runtimeClient() {
  function evidenceDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('sv-SE', { dateStyle:'short', timeZone:'Europe/Stockholm' }).format(date);
  }
  function evidenceNumber(value) {
    if (value == null || value === '') return '—';
    return Number(value).toLocaleString('sv-SE', { maximumFractionDigits:1 });
  }
  function placing(row) {
    const values = [row.wins,row.seconds,row.thirds];
    return values.every((value) => value == null) ? '—' : values.map((value) => value == null ? '—' : value).join('-');
  }
  function roleLabel(value) {
    const key = String(value || '').toLowerCase();
    return ({trainer:'Tränare',stable_representative:'Stallrepresentant',owner:'Ägare',other:'Övrig'})[key] || value || 'Talare';
  }
  function factLabel(value) {
    const key = String(value || '').toLowerCase();
    return ({fact:'Fakta',intention:'Intention',soft_signal:'Mjuk signal',opinion:'Bedömning',mixed:'Blandat'})[key] || value || '';
  }
  function signalTypeLabel(value) {
    const key = String(value || '').toLowerCase();
    return ({form:'Form',training:'Träning',tactics:'Taktik',distance:'Distans',start:'Start/spår',equipment:'Utrustning',expectation:'Förväntan',other:'Övrigt'})[key] || value || 'Signal';
  }
  function statsViewExternal(data) {
    const items = data?.items || [];
    if (!items.length) return '<div class="card"><div class="empty"><strong>Ingen extern statistik</strong>Inga externa statistikobservationer finns sparade för hästen ännu.</div></div>';
    const groups = new Map();
    for (const item of items) {
      const key = item.contextType + '|' + String(item.contextKey || '');
      if (!groups.has(key)) groups.set(key, { label:item.contextLabel, rows:[] });
      groups.get(key).rows.push(item);
    }
    return '<div class="external-evidence-groups">' + [...groups.values()].map((group) =>
      '<section class="data-section external-evidence-section"><div class="data-section-head"><h2>' + esc(group.label) + '</h2><span>' + group.rows.length + ' observationer</span></div>' +
      '<div class="external-evidence-table-wrap"><table class="external-evidence-table"><thead><tr><th>Observerad</th><th>Starter</th><th>Placering</th><th>Seger %</th><th>ROI</th></tr></thead><tbody>' +
      group.rows.map((row) => '<tr><td>' + esc(evidenceDate(row.observedAt)) + '</td><td>' + esc(evidenceNumber(row.starts)) + '</td><td>' + esc(placing(row)) + '</td><td>' + esc(row.winRatePercent == null ? '—' : evidenceNumber(row.winRatePercent) + '%') + '</td><td>' + esc(row.roiPercent == null ? '—' : evidenceNumber(row.roiPercent) + '%') + '</td></tr>').join('') +
      '</tbody></table></div></section>'
    ).join('') + '</div>';
  }
  function interviewsViewExternal(data, page) {
    const items = data?.items || [];
    if (!items.length) return '<div class="card"><div class="empty"><strong>Inga intervjuer</strong>Ingen intervjuhistorik finns sparad ännu.</div></div>';
    return '<div class="external-interview-list">' + items.map((item) => {
      const speaker = item.speakerName ? item.speakerName + ' · ' + roleLabel(item.speakerRole) : roleLabel(item.speakerRole);
      const horse = page === 'trainers' && item.horseName ? '<div class="external-interview-horse">' + esc(item.horseName) + '</div>' : '';
      const signals = (item.signals || []).map((signal) =>
        '<div class="external-signal"><div class="external-signal-head"><strong>' + esc(signalTypeLabel(signal.type)) + '</strong><span>' + esc(factLabel(signal.fact_or_opinion)) + '</span></div>' +
        (signal.value ? '<div>' + esc(signal.value) + '</div>' : '') +
        (signal.evidence_excerpt ? '<div class="external-signal-evidence">' + esc(signal.evidence_excerpt) + '</div>' : '') +
        '</div>'
      ).join('');
      return '<section class="card external-interview-card"><div class="card-pad">' +
        '<div class="external-interview-head"><div>' + horse + '<strong>' + esc(speaker) + '</strong></div><span>' + esc(evidenceDate(item.publishedAt)) + '</span></div>' +
        (item.summary ? '<div class="external-interview-summary">' + esc(item.summary) + '</div>' : '') +
        (signals ? '<div class="external-signal-grid">' + signals + '</div>' : '') +
        '</div></section>';
    }).join('') + '</div>';
  }
  function renderEvidenceBody(html) {
    const tabBar = app.querySelector(':scope > .tabs');
    if (!tabBar) return;
    let node = tabBar.nextSibling;
    while (node) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    tabBar.insertAdjacentHTML('afterend', html);
  }

  const priorDetailTabs = detailTabs;
  detailTabs = function(type) {
    const base = priorDetailTabs(type).map((row) => [...row]);
    const withoutEvidence = base.filter((row) => row[0] !== 'external_stats' && row[0] !== 'interviews');
    const statsIndex = Math.max(0, withoutEvidence.findIndex((row) => row[0] === 'stats'));
    if (type === 'horse') withoutEvidence.splice(statsIndex + 1, 0, ['external_stats','Extern statistik'], ['interviews','Intervjuer']);
    if (type === 'trainer') withoutEvidence.splice(statsIndex + 1, 0, ['interviews','Intervjuer']);
    return withoutEvidence;
  };

  const priorStatsView = statsView;
  statsView = function(detail) {
    const page = state.detail?.page;
    if (state.tab === 'stats' && ['horses','trainers','drivers'].includes(page)) {
      return '<div class="data-groups entity-detail-bootstrap-skeleton"><div class="skeleton"></div></div>';
    }
    return priorStatsView(detail);
  };

  const priorRenderDetail = renderDetail;
  renderDetail = async function() {
    const requestedTab = state.tab;
    const page = state.detail?.page;
    const id = state.detail?.id;
    await priorRenderDetail();
    if (!id || !state.detail || state.detail.id !== id || state.tab !== requestedTab) return;

    if (requestedTab === 'external_stats' && page === 'horses') {
      renderEvidenceBody('<div class="skeleton"></div>');
      try {
        const data = await api('/horses/' + encodeURIComponent(id) + '/external-statistics');
        if (!state.detail || state.detail.id !== id || state.tab !== requestedTab) return;
        renderEvidenceBody(statsViewExternal(data));
      } catch (error) {
        renderEvidenceBody('<div class="notice">Kunde inte läsa extern statistik: ' + esc(error.message) + '</div>');
      }
      return;
    }

    if (requestedTab === 'interviews' && (page === 'horses' || page === 'trainers')) {
      renderEvidenceBody('<div class="skeleton"></div>');
      try {
        const endpoint = page === 'horses' ? '/horses/' : '/trainers/';
        const data = await api(endpoint + encodeURIComponent(id) + '/interviews');
        if (!state.detail || state.detail.id !== id || state.tab !== requestedTab) return;
        renderEvidenceBody(interviewsViewExternal(data, page));
      } catch (error) {
        renderEvidenceBody('<div class="notice">Kunde inte läsa intervjuer: ' + esc(error.message) + '</div>');
      }
    }
  };
}

export function enhanceEntityDetailUiHtml(html) {
  let enhanced = enhanceEntityDetailStatisticsHtmlV2(html);
  if (!enhanced.includes(SUCCESS_RENDER)) throw new Error('entity detail UI composition target is missing');
  if (!enhanced.includes(TRAINER_SPECIALS)) throw new Error('trainer detail specialist target is missing');
  if (!enhanced.includes(HORSE_AGE_OPTIONS)) throw new Error('horse detail age-option target is missing');
  if (!enhanced.includes(LEGACY_CLEANUP)) throw new Error('legacy detail cleanup target is missing');
  enhanced = enhanced.replace(TRAINER_SPECIALS, TRAINER_SPECIALS_WITH_HOME);
  enhanced = enhanced.replace(HORSE_AGE_OPTIONS, HORSE_AGE_OPTIONS_FOR_YEAR);
  enhanced = enhanced.replace(LEGACY_CLEANUP, COMPLETE_CLEANUP);
  enhanced = enhanced.replace(SUCCESS_RENDER, ORDERED_RENDER);
  if (!enhanced.includes('kentaurai-external-evidence-ui-style')) {
    enhanced = enhanced.replace('</head>', externalEvidenceCss + '</head>');
  }
  if (!enhanced.includes('kentaurai-entity-detail-ui-runtime')) {
    const finalScript = '<script id="kentaurai-entity-detail-ui-runtime">(' + runtimeClient.toString() + ')();</script>';
    enhanced = enhanced.replace('</body>', finalScript + '</body>');
  }
  return enhanced;
}
