function externalAnalysisUiClient() {
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char];
    });
  }
  async function jsonFetch(url, options) {
    const config = options || {};
    config.headers = Object.assign({accept:'application/json'}, config.headers || {});
    const response = await fetch(url, config);
    const data = await response.json().catch(function(){ return {}; });
    if (!response.ok) throw new Error(data.message || data.error || 'Begäran misslyckades');
    return data;
  }
  async function copyPrompt(button, url) {
    const old = button.textContent;
    button.disabled = true;
    try {
      const data = await jsonFetch(url);
      if (!data.prompt) throw new Error('Instruktionen saknas');
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(data.prompt);
      else {
        const area = document.createElement('textarea');
        area.value = data.prompt;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      button.textContent = '✓ Kopierat';
    } catch (error) {
      button.textContent = 'Kunde inte kopiera';
    } finally {
      setTimeout(function(){ button.textContent = old; button.disabled = false; }, 1500);
    }
  }
  function download(url) { window.location.href = url; }
  function analysisRound() { const node = document.getElementById('externalAnalysisRound'); return node ? node.value : ''; }
  function registrationRound() { const node = document.getElementById('externalRegistrationRound'); return node ? node.value : ''; }
  function provider() { const node = document.getElementById('externalProvider'); return node ? node.value : 'openai'; }

  async function loadRounds(scope, selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    try {
      const data = await jsonFetch('/app/api/settings/external-rounds?scope=' + encodeURIComponent(scope));
      const rounds = data.rounds || [];
      select.innerHTML = rounds.length ? rounds.map(function(round) {
        return '<option value="' + esc(round.id) + '">' + esc(round.gameType) + ' ' + esc(round.roundDate) + (round.hasRecordedSystem ? ' · registrerad' : '') + '</option>';
      }).join('') : '<option value="">Ingen komplett V85/V86-omgång</option>';
    } catch (error) {
      select.innerHTML = '<option value="">Kunde inte läsa omgångar</option>';
    }
  }

  async function importSystem(button) {
    const input = document.getElementById('externalSystemFile');
    const file = input && input.files ? input.files[0] : null;
    const box = document.getElementById('externalMessage');
    const roundId = registrationRound();
    if (!roundId) { box.className = 'settings-result show error'; box.textContent = 'Välj en omgång först.'; return; }
    if (!file) { box.className = 'settings-result show error'; box.textContent = 'Välj en JSON-fil först.'; return; }
    button.disabled = true;
    box.className = 'settings-result';
    try {
      const text = await file.text();
      const result = await jsonFetch('/app/api/settings/system-import?round_id=' + encodeURIComponent(roundId), {
        method:'POST', headers:{'content-type':'application/json'}, body:text
      });
      const first = result.systems && result.systems[0];
      box.className = 'settings-result show success';
      box.textContent = first ? 'Systemet är sparat: ' + first.spike_count + ' spikar · ' + first.row_count + ' rader · ' + first.cost_sek + ' kr.' : 'Systemet är validerat och sparat.';
      await loadRounds('registration', 'externalRegistrationRound');
    } catch (error) {
      box.className = 'settings-result show error';
      box.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function workflowMarkup() {
    return '<div id="externalWorkflowCard" class="external-workflow">' +
      '<h2 class="external-section-title">Analysera omgång</h2>' +
      '<section class="settings-section settings-card external-card">' +
        '<div class="external-context">' +
          '<div class="settings-field"><label for="externalAnalysisRound">Omgång</label><select id="externalAnalysisRound" class="settings-select"><option>Läser…</option></select></div>' +
          '<div class="settings-field"><label for="externalProvider">AI</label><select id="externalProvider" class="settings-select"><option value="openai">ChatGPT</option><option value="anthropic">Claude</option></select></div>' +
        '</div>' +
        '<div class="external-card-body"><div class="external-timeline">' +
          '<div class="external-node"><span>1</span></div><div class="external-step"><h3>Marknadsblind analys</h3><div class="settings-actions"><button id="externalDownloadPack" class="settings-primary" type="button">Hämta analysdata</button><button id="externalCopyStep1" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>' +
          '<div class="external-node external-last"><span>2</span></div><div class="external-step"><h3>Marknad och system</h3><div class="settings-actions"><button id="externalDownloadMarket" class="settings-primary" type="button">Hämta marknadsdata</button><button id="externalCopyStep2" class="settings-secondary" type="button">Kopiera instruktion</button></div></div>' +
        '</div></div>' +
      '</section>' +
      '<h2 class="external-section-title">Registrera system</h2>' +
      '<section class="settings-section settings-card external-card">' +
        '<div class="external-context"><div class="settings-field"><label for="externalRegistrationRound">Omgång</label><select id="externalRegistrationRound" class="settings-select"><option>Läser…</option></select></div></div>' +
        '<div class="external-card-body"><div class="external-timeline">' +
          '<div class="external-node external-last"><span>3</span></div><div class="external-step"><h3>Registrera färdigt system</h3>' +
            '<div class="settings-actions"><button id="externalDownloadImport" class="settings-primary" type="button">Hämta importunderlag</button><button id="externalCopyImport" class="settings-secondary" type="button">Kopiera importinstruktion</button></div>' +
            '<div class="settings-actions external-import"><div class="settings-field"><label for="externalSystemFile">Systemfil</label><input id="externalSystemFile" class="settings-file" type="file" accept="application/json,.json"></div><button id="externalImportSystem" class="settings-secondary" type="button">Importera system</button></div>' +
            '<div id="externalMessage" class="settings-result"></div>' +
          '</div>' +
        '</div></div>' +
      '</section>' +
    '</div>';
  }

  function installWorkflow() {
    const layout = document.querySelector('.settings-layout');
    if (!layout || document.getElementById('externalWorkflowCard')) return;
    const activeAi = Array.from(document.querySelectorAll('.tab.active')).some(function(node){ return node.textContent.trim() === 'AI'; });
    if (!activeAi) return;
    const host = document.createElement('div');
    host.innerHTML = workflowMarkup();
    const card = host.firstChild;
    layout.insertBefore(card, layout.firstChild);
    const intro = layout.querySelector(':scope > .analysis-workflow-intro');
    if (intro) intro.style.display = 'none';
    Array.from(layout.querySelectorAll(':scope > .settings-section')).forEach(function(section){ section.style.display = 'none'; });

    document.getElementById('externalDownloadPack').addEventListener('click', function(){ const id=analysisRound(); if(id) download('/app/api/settings/f3-analysis-pack?round_id=' + encodeURIComponent(id)); });
    document.getElementById('externalCopyStep1').addEventListener('click', function(event){ copyPrompt(event.currentTarget, '/app/api/settings/external-step1-prompt?provider=' + encodeURIComponent(provider())); });
    document.getElementById('externalDownloadMarket').addEventListener('click', function(){ const id=analysisRound(); if(id) download('/app/api/settings/external-market?round_id=' + encodeURIComponent(id)); });
    document.getElementById('externalCopyStep2').addEventListener('click', function(event){ copyPrompt(event.currentTarget, '/app/api/settings/external-step2-prompt?provider=' + encodeURIComponent(provider())); });
    document.getElementById('externalDownloadImport').addEventListener('click', function(){ const id=registrationRound(); if(id) download('/app/api/settings/system-import-context?round_id=' + encodeURIComponent(id)); });
    document.getElementById('externalCopyImport').addEventListener('click', function(event){ copyPrompt(event.currentTarget, '/app/api/settings/system-import-prompt?provider=' + encodeURIComponent(provider())); });
    document.getElementById('externalImportSystem').addEventListener('click', function(event){ importSystem(event.currentTarget); });
    loadRounds('analysis','externalAnalysisRound');
    loadRounds('registration','externalRegistrationRound');
  }

  async function loadOperationalStatus() {
    const box = document.getElementById('externalOperationalBody');
    if (!box) return;
    try {
      const data = await jsonFetch('/app/api/settings/f3-operational-status');
      const current = data.current_round || {};
      function metric(value) { return value && value.percent != null ? value.percent + '%' : '—'; }
      box.innerHTML =
        '<div class="external-coverage">' +
          '<div><strong>' + esc(current.active_entries == null ? '—' : current.active_entries) + '</strong><span>Aktiva starter</span></div>' +
          '<div><strong>' + esc(metric(current.current_start_points)) + '</strong><span>Start Points</span></div>' +
          '<div><strong>' + esc(metric(current.current_entry_equipment)) + '</strong><span>Utrustning</span></div>' +
          '<div><strong>' + esc(metric(current.horses_with_prior_verified_xlabs)) + '</strong><span>X-Labs historik</span></div>' +
        '</div>';
    } catch (error) {
      box.innerHTML = '<div class="external-error">Kunde inte läsa driftstatus: ' + esc(error.message) + '</div>';
    }
  }

  function installOperational() {
    const layout = document.querySelector('.settings-layout');
    if (!layout || document.getElementById('externalOperationalCard')) return;
    const activeData = Array.from(document.querySelectorAll('.tab.active')).some(function(node){ return node.textContent.trim() === 'Data'; });
    if (!activeData) return;
    const section = document.createElement('section');
    section.id = 'externalOperationalCard';
    section.className = 'settings-section settings-card';
    section.innerHTML = '<div class="settings-card-head"><h2>Datatäckning och drift</h2></div>' +
      '<div class="settings-card-body"><div class="settings-actions"><button id="externalCoverageDownload" class="settings-secondary" type="button">Hämta full datatäckningsrapport</button></div>' +
      '<div id="externalOperationalBody"><div class="settings-help">Läser status…</div></div></div>';
    layout.appendChild(section);
    document.getElementById('externalCoverageDownload').addEventListener('click', function(){ download('/app/api/settings/data-coverage'); });
    loadOperationalStatus();
  }

  function install() {
    const activeAi = Array.from(document.querySelectorAll('.tab.active')).some(function(node){ return node.textContent.trim() === 'AI'; });
    if (activeAi) installWorkflow();
    const activeData = Array.from(document.querySelectorAll('.tab.active')).some(function(node){ return node.textContent.trim() === 'Data'; });
    if (activeData) installOperational();
  }
  const observer = new MutationObserver(function(){ queueMicrotask(install); });
  observer.observe(document.getElementById('app') || document.body, {childList:true,subtree:true});
  install();
}

const externalCss = '<style id="kentaurai-external-analysis-ui-style">' +
'.external-workflow{display:grid;gap:0}.external-section-title{font-size:18px;margin:16px 0 9px}.external-card{border-color:#3a3125;overflow:hidden}.external-context{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:16px 18px;border-bottom:1px solid var(--line-soft)}.external-context .settings-field{min-width:230px}.external-card-body{padding:18px}.external-timeline{display:grid;grid-template-columns:34px minmax(0,1fr);gap:0 14px}.external-node{position:relative}.external-node span{width:30px;height:30px;border:1px solid #a77f49;border-radius:50%;display:grid;place-items:center;color:#d0b178;font-size:12px;font-weight:700}.external-node:not(.external-last)::after{content:"";position:absolute;top:31px;left:14px;bottom:-18px;width:1px;background:var(--line-soft)}.external-step{padding:2px 0 22px}.external-step h3{font-size:14px;margin:4px 0 10px}.external-import{margin-top:12px;align-items:end}.external-import .settings-field{min-width:260px}' +
'@media(max-width:760px){.external-coverage{grid-template-columns:1fr 1fr}.external-context{display:grid}.external-context .settings-field,.external-import .settings-field{min-width:0;width:100%}.external-step .settings-actions,.external-import{display:grid}.external-step .settings-primary,.external-step .settings-secondary,.external-step .settings-file{width:100%;max-width:none}}' +
'</style>';

function stripLegacyF3(html) {
  return String(html)
    .replace(/<style id="kentaurai-f3-private-ui-style">[\s\S]*?<\/style>/, '')
    .replace(/<script id="kentaurai-f3-private-ui-script">[\s\S]*?<\/script>/, '');
}

export function enhanceExternalAnalysisUiHtml(html) {
  let text = stripLegacyF3(html);
  if (text.includes('kentaurai-external-analysis-ui-script')) return text;
  text = text.replace('</head>', externalCss + '</head>');
  text = text.replace('</body>', '<script id="kentaurai-external-analysis-ui-script">(' + externalAnalysisUiClient.toString() + ')();</script></body>');
  return text;
}
