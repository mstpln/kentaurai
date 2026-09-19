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

export function enhanceEntityDetailRuntimeFinalHtml(html) {
  const text = String(html);
  if (text.includes('kentaurai-entity-detail-runtime-final')) return text;
  const script = '<script id="kentaurai-entity-detail-runtime-final">(' + runtimeClient.toString() + ')();</script>';
  return text.replace('</body>', script + '</body>');
}
