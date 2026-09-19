import { enhanceEntityDetailStatisticsHtmlV2 } from './entity-detail-statistics-ui-v2.js';

const canonicalDetailCss = '<style id="kentaurai-entity-detail-canonical-style">' +
'.entity-detail-bootstrap-skeleton{margin-top:14px}' +
'</style>';

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
  detailTabs = function(type) {
    if (type === 'horse') return [['stats','Statistik'],['external_stats','Extern statistik'],['interviews','Intervjuer'],['starts','Starter'],['data','Data']];
    if (type === 'trainer') return [['stats','Statistik'],['interviews','Intervjuer'],['starts','Starter'],['horses','Hästar'],['data','Data']];
    return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']];
  };

  function current(page,id,tab) {
    return Boolean(state.detail && state.detail.page === page && state.detail.id === id && state.tab === tab);
  }
  function bindCanonicalShell(page,detail) {
    document.getElementById('backBtn').onclick=()=>{state.detail=null;state.tab='list';renderEntityList(page)};
    bindTabs(renderDetail);
    bindRoleLinks();
    document.querySelectorAll('[data-horse]').forEach(x=>x.onclick=()=>openDetail('horses',x.dataset.horse));
    if(state.tab==='starts'||state.tab==='equipment')bindHorseLinks(state.tab==='equipment'?{...detail,starts:(detail.starts||[]).filter(r=>r.equipment)}:detail);
  }
  async function renderCanonicalShell(page,id,tab) {
    const detail=await api('/entities/'+page+'/'+encodeURIComponent(id));
    if(!current(page,id,tab))return null;
    const e=detail.entity,type=detail.type,roles=await roleLine(type,e);
    if(!current(page,id,tab))return null;
    let body='';
    if(tab==='stats')body='<div id="entityDetailStatisticsV2" class="entity-detail-v2 entity-detail-bootstrap-skeleton"><div class="skeleton"></div></div>';
    if(tab==='external_stats'||tab==='interviews')body='<div id="entityDetailEvidenceBody" class="entity-detail-bootstrap-skeleton"><div class="skeleton"></div></div>';
    app.innerHTML='<button class="back" id="backBtn">'+FINAL_ICONS.back+'<span>'+esc(labels[page])+'</span></button><div class="detail-head"><div class="avatar">'+esc(initials(e.name))+'</div><div><div class="detail-name">'+esc(e.name)+'</div>'+roles+(e.country_code?'<div class="detail-location">'+esc(e.country_code)+'</div>':'')+'</div></div>'+tabs(detailTabs(type),tab)+body;
    bindCanonicalShell(page,detail);
    return detail;
  }
  const legacyRenderDetail = renderDetail;
  renderDetail = async function() {
    const requestedTab = state.tab;
    const page = state.detail?.page;
    const id = state.detail?.id;
    if (!id) return;
    if (!['stats','external_stats','interviews'].includes(requestedTab)) return legacyRenderDetail();
    const detail=await renderCanonicalShell(page,id,requestedTab);
    if(!detail||!current(page,id,requestedTab))return;

    if (requestedTab === 'stats') {
      await window.__kentauraiEntityDetailStatistics.mount();
      return;
    }

    if (requestedTab === 'external_stats' && page === 'horses') {
      const host=document.getElementById('entityDetailEvidenceBody');
      try {
        const data = await api('/horses/' + encodeURIComponent(id) + '/external-statistics');
        if (!host || !current(page,id,requestedTab)) return;
        host.innerHTML=statsViewExternal(data);
      } catch (error) {
        if(host)host.innerHTML='<div class="notice">Kunde inte läsa extern statistik: ' + esc(error.message) + '</div>';
      }
      return;
    }

    if (requestedTab === 'interviews' && (page === 'horses' || page === 'trainers')) {
      const host=document.getElementById('entityDetailEvidenceBody');
      try {
        const endpoint = page === 'horses' ? '/horses/' : '/trainers/';
        const data = await api(endpoint + encodeURIComponent(id) + '/interviews');
        if (!host || !current(page,id,requestedTab)) return;
        host.innerHTML=interviewsViewExternal(data, page);
      } catch (error) {
        if(host)host.innerHTML='<div class="notice">Kunde inte läsa intervjuer: ' + esc(error.message) + '</div>';
      }
      return;
    }
    return legacyRenderDetail();
  };
}

export function enhanceEntityDetailUiHtml(html) {
  const source = String(html);
  if (source.includes('kentaurai-entity-detail-ui-runtime') && source.includes('kentaurai-entity-detail-canonical-style')) return source;
  let enhanced = enhanceEntityDetailStatisticsHtmlV2(source);
  if (!enhanced.includes('kentaurai-entity-detail-canonical-style')) {
    enhanced = enhanced.replace('</head>', canonicalDetailCss + '</head>');
  }
  if (!enhanced.includes('kentaurai-external-evidence-ui-style')) {
    enhanced = enhanced.replace('</head>', externalEvidenceCss + '</head>');
  }
  if (!enhanced.includes('kentaurai-entity-detail-ui-runtime')) {
    const finalScript = '<script id="kentaurai-entity-detail-ui-runtime">(' + runtimeClient.toString() + ')();</script>';
    enhanced = enhanced.replace('</body>', finalScript + '</body>');
  }
  return enhanced;
}
