function externalEvidenceUiClient() {
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
  function replaceEvidenceBody(html) {
    const tabBar = document.querySelector('.tabs');
    if (!tabBar) return;
    let node = tabBar.nextSibling;
    while (node) { const next = node.nextSibling; node.remove(); node = next; }
    tabBar.insertAdjacentHTML('afterend', html);
  }
  function statsView(data) {
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
  function interviewsView(data, page) {
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

  function evidenceTabs(page) {
    if (page === 'horses') return [['external_stats','Extern statistik'],['interviews','Intervjuer']];
    if (page === 'trainers') return [['interviews','Intervjuer']];
    return [];
  }
  function ensureEvidenceTabs() {
    const page = state.detail?.page;
    const tabBar = document.querySelector('.tabs');
    if (!tabBar || !page) return;
    const wanted = evidenceTabs(page);
    tabBar.querySelectorAll('[data-external-evidence-tab="1"]').forEach((button) => {
      if (!wanted.some((row) => row[0] === button.dataset.tab)) button.remove();
    });
    let anchor = tabBar.querySelector('.tab[data-tab="stats"]');
    for (const [key,label] of wanted) {
      let button = tabBar.querySelector('.tab[data-tab="' + key + '"]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab';
        button.dataset.tab = key;
        button.textContent = label;
        if (anchor?.nextSibling) tabBar.insertBefore(button, anchor.nextSibling);
        else tabBar.appendChild(button);
      }
      button.dataset.externalEvidenceTab = '1';
      anchor = button;
    }
    tabBar.querySelectorAll('.tab[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === state.tab);
    });
  }
  async function renderEvidenceTab(page, id, requestedTab) {
    replaceEvidenceBody('<div class="skeleton"></div>');
    try {
      if (requestedTab === 'external_stats' && page === 'horses') {
        const data = await api('/horses/' + encodeURIComponent(id) + '/external-statistics');
        if (!state.detail || state.detail.id !== id || state.tab !== requestedTab) return;
        replaceEvidenceBody(statsView(data));
        return;
      }
      if (requestedTab === 'interviews' && (page === 'horses' || page === 'trainers')) {
        const endpoint = page === 'horses' ? '/horses/' : '/trainers/';
        const data = await api(endpoint + encodeURIComponent(id) + '/interviews');
        if (!state.detail || state.detail.id !== id || state.tab !== requestedTab) return;
        replaceEvidenceBody(interviewsView(data, page));
      }
    } catch (error) {
      const label = requestedTab === 'external_stats' ? 'extern statistik' : 'intervjuer';
      replaceEvidenceBody('<div class="notice">Kunde inte läsa ' + label + ': ' + esc(error.message) + '</div>');
    }
  }
  document.addEventListener('click', function(event) {
    const target = event.target instanceof Element ? event.target.closest('.tab[data-external-evidence-tab="1"]') : null;
    if (!target || !state.detail) return;
    const requestedTab = target.dataset.tab;
    const page = state.detail.page;
    if (!evidenceTabs(page).some((row) => row[0] === requestedTab)) return;
    event.preventDefault();
    event.stopPropagation();
    state.tab = requestedTab;
    ensureEvidenceTabs();
    void renderEvidenceTab(page, state.detail.id, requestedTab);
  }, true);
  const detailHost = document.getElementById('app');
  if (detailHost) {
    let scheduled = false;
    new MutationObserver(function() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(function() {
        scheduled = false;
        ensureEvidenceTabs();
      });
    }).observe(detailHost, { childList:true, subtree:true });
  }
  ensureEvidenceTabs();
}

const externalEvidenceCss = '<style id="kentaurai-external-evidence-ui-style">' +
'.external-evidence-groups,.external-interview-list{display:grid;gap:14px}.external-evidence-section{overflow:hidden}.external-evidence-table-wrap{overflow-x:auto}.external-evidence-table{width:100%;border-collapse:collapse}.external-evidence-table th,.external-evidence-table td{padding:10px 12px;border-bottom:1px solid var(--line-soft);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.external-evidence-table th:first-child,.external-evidence-table td:first-child{text-align:left}.external-evidence-table th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:#10100f}.external-evidence-table td{font-size:12px}.external-evidence-table tr:last-child td{border-bottom:0}.external-interview-card{overflow:hidden}.external-interview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.external-interview-head>span{font-size:10px;color:var(--muted);white-space:nowrap}.external-interview-horse{font-size:10px;color:var(--accent-soft);margin-bottom:2px}.external-interview-summary{font-size:12px;line-height:1.55;color:#c7c0b6;margin-top:10px}.external-signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.external-signal{border:1px solid var(--line-soft);border-radius:9px;padding:9px 10px;font-size:11px;line-height:1.45}.external-signal-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}.external-signal-head span{font-size:9px;color:var(--muted)}.external-signal-evidence{margin-top:4px;color:var(--muted);font-size:10px}' +
'@media(max-width:620px){.external-signal-grid{grid-template-columns:1fr}.external-evidence-table th,.external-evidence-table td{padding:9px 7px;font-size:9px}.external-evidence-table th{font-size:7px}}' +
'</style>';

export function enhanceExternalEvidenceUiHtml(html) {
  let text = String(html);
  if (text.includes('kentaurai-external-evidence-ui-script')) return text;
  text = text.replace('</head>', externalEvidenceCss + '</head>');
  text = text.replace('</body>', '<script id="kentaurai-external-evidence-ui-script">(' + externalEvidenceUiClient.toString() + ')();</script></body>');
  return text;
}
