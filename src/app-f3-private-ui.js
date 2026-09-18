function f3PrivateUiClient() {
  const STATUS_SV = {
    ready: 'Redo',
    completed: 'Klar',
    blocked: 'Väntar'
  };
  const REASON_SV = {
    step1_lock_required: 'Försegla Steg 1 först.',
    late_facts_require_revision: 'Nya fakta finns efter låset. Revidera Steg 1 innan marknadssteget.',
    older_lock_superseded: 'Ett nyare Steg 1-lås finns.',
    market_gate_not_ready: 'Marknadssteget är inte tillgängligt ännu.'
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { accept: 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Begäran misslyckades');
    return data;
  }

  async function copyText(button, url) {
    const old = button.textContent;
    button.disabled = true;
    try {
      const data = await jsonFetch(url);
      if (!data.prompt) throw new Error('Instruktionen saknas');
      await navigator.clipboard.writeText(data.prompt);
      button.textContent = '✓ Kopierat';
    } catch {
      button.textContent = 'Kunde inte kopiera';
    } finally {
      setTimeout(() => { button.textContent = old; button.disabled = false; }, 1500);
    }
  }

  function roundId() { return document.getElementById('f3Round')?.value || ''; }
  function provider() { return document.getElementById('f3Provider')?.value || 'openai'; }

  function download(url) { window.location.href = url; }

  async function downloadJson(url, filename) {
    const data = await jsonFetch(url);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function stepRow(key, label, step) {
    const status = step?.status || 'blocked';
    const reason = step?.reason ? (REASON_SV[step.reason] || step.reason) : '';
    return `<div class="f3-step-row">
      <div><strong>${esc(label)}</strong>${reason ? `<span>${esc(reason)}</span>` : ''}</div>
      <em class="f3-status ${esc(status)}">${esc(STATUS_SV[status] || status)}</em>
    </div>`;
  }

  function gate(button, enabled) {
    if (button) button.disabled = !enabled;
  }

  async function refreshWorkflow() {
    const id = roundId();
    const host = document.getElementById('f3WorkflowState');
    if (!id || !host) return;
    host.innerHTML = '<div class="f3-loading">Läser v3-status…</div>';
    try {
      const data = await jsonFetch('/app/api/settings/f3-workflow-state?round_id=' + encodeURIComponent(id));
      const s = data.steps || {};
      host.innerHTML = [
        stepRow('analysis_pack', '1. Marknadsblind analysdata', s.analysis_pack),
        stepRow('step1_lock', '2. Förseglat Steg 1', s.step1_lock),
        stepRow('market_pack', '3. Marknadsdata', s.market_pack),
        stepRow('step2_import', '4. Steg 2-import', s.step2_import),
        stepRow('optimized_system', '5. Optimerat system', s.optimized_system)
      ].join('');
      gate(document.getElementById('f3DownloadPack'), s.analysis_pack?.status === 'ready');
      gate(document.getElementById('f3ImportLock'), s.step1_lock?.status !== 'completed');
      gate(document.getElementById('f3DownloadMarket'), s.market_pack?.status === 'ready');
      gate(document.getElementById('f3ImportStep2'), s.step2_import?.status === 'ready');
      const revision = document.getElementById('f3RevisionAction');
      if (revision) revision.hidden = data.market_gate?.reason !== 'late_facts_require_revision';
      const systemBox = document.getElementById('f3SystemSummary');
      if (systemBox) {
        if (data.system) {
          systemBox.hidden = false;
          systemBox.innerHTML = `<strong>System klart</strong><span>${esc(data.system.spike_count)} spikar · ${esc(data.system.row_count)} rader · ${esc(data.system.cost_sek)} kr</span>`;
        } else {
          systemBox.hidden = true;
          systemBox.textContent = '';
        }
      }
    } catch (error) {
      host.innerHTML = '<div class="f3-error">' + esc(error.message) + '</div>';
    }
  }

  async function importJsonFile(inputId, url, button) {
    const file = document.getElementById(inputId)?.files?.[0];
    if (!file) throw new Error('Välj en JSON-fil först.');
    button.disabled = true;
    try {
      const text = await file.text();
      await jsonFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
      await refreshWorkflow();
    } finally {
      button.disabled = false;
    }
  }

  async function loadRounds() {
    const select = document.getElementById('f3Round');
    if (!select) return;
    try {
      const data = await jsonFetch('/app/api/settings/f3-rounds');
      const rounds = data.rounds || [];
      select.innerHTML = rounds.length
        ? rounds.map((round) => `<option value="${esc(round.id)}">${esc(round.gameType)} ${esc(round.roundDate)}${round.hasV3Analysis ? ' · klar' : ''}</option>`).join('')
        : '<option value="">Ingen komplett V85/V86-omgång</option>';
      await refreshWorkflow();
    } catch (error) {
      select.innerHTML = '<option value="">Kunde inte läsa omgångar</option>';
    }
  }

  function workflowCard() {
    const section = document.createElement('section');
    section.id = 'f3WorkflowCard';
    section.className = 'settings-section settings-card f3-card';
    section.innerHTML = `
      <div class="settings-card-head">
        <div class="analysis-step-number">V3 · Analysflöde</div>
        <h2>Från marknadsblind analys till färdigt system</h2>
        <p>Följ stegen i ordning. KentaurAI öppnar nästa steg först när föregående v3-steg är giltigt och förseglat.</p>
      </div>
      <div class="settings-card-body">
        <div class="settings-actions f3-toolbar">
          <div class="settings-field"><label for="f3Round">Omgång</label><select id="f3Round" class="settings-select"><option>Läser…</option></select></div>
          <div class="settings-field"><label for="f3Provider">AI</label><select id="f3Provider" class="settings-select"><option value="openai">ChatGPT</option><option value="anthropic">Claude</option></select></div>
        </div>
        <div id="f3WorkflowState" class="f3-state"></div>

        <div class="f3-actions-grid">
          <div class="f3-action">
            <strong>Steg 1</strong>
            <span>Hämta hela marknadsblinda analysunderlaget som en fil och kopiera v3-instruktionen.</span>
            <div class="settings-actions">
              <button id="f3DownloadPack" class="settings-primary" type="button">Hämta analysdata</button>
              <button id="f3CopyStep1" class="settings-secondary" type="button">Kopiera Steg 1-instruktion</button>
            </div>
          </div>
          <div class="f3-action">
            <strong>Försegla Steg 1</strong>
            <span>Ladda upp JSON-filen från AI:n. Marknadssteget öppnas först efter ett giltigt server-lås.</span>
            <div class="settings-actions">
              <input id="f3LockFile" class="settings-file" type="file" accept="application/json,.json">
              <button id="f3ImportLock" class="settings-primary" type="button">Försegla Steg 1</button>
            </div>
          </div>
          <div class="f3-action" id="f3RevisionAction" hidden>
            <strong>Revidera Steg 1</strong>
            <span>Nya marknadsblinda fakta har kommit efter låset. Hämta revisionsunderlaget, låt AI:n ompröva endast berörda avdelningar och importera revisionen.</span>
            <div class="settings-actions">
              <button id="f3DownloadRevision" class="settings-secondary" type="button">Hämta revisionsunderlag</button>
              <button id="f3CopyRevision" class="settings-secondary" type="button">Kopiera revisionsinstruktion</button>
            </div>
            <div class="settings-actions f3-import">
              <input id="f3RevisionFile" class="settings-file" type="file" accept="application/json,.json">
              <button id="f3ImportRevision" class="settings-primary" type="button">Importera revision</button>
            </div>
          </div>
          <div class="f3-action">
            <strong>Steg 2</strong>
            <span>Hämta marknadsfilen, fortsätt i samma AI-konversation och importera svaret. Systemet optimeras därefter i kod.</span>
            <div class="settings-actions">
              <button id="f3DownloadMarket" class="settings-primary" type="button">Hämta marknadsdata</button>
              <button id="f3CopyStep2" class="settings-secondary" type="button">Kopiera Steg 2-instruktion</button>
            </div>
            <div class="settings-actions f3-import">
              <input id="f3Step2File" class="settings-file" type="file" accept="application/json,.json">
              <button id="f3ImportStep2" class="settings-primary" type="button">Importera och optimera</button>
            </div>
          </div>
        </div>
        <div id="f3SystemSummary" class="f3-system" hidden></div>
        <div id="f3Message" class="settings-result"></div>
      </div>`;
    return section;
  }

  async function loadOperationalStatus() {
    const box = document.getElementById('f3OperationalBody');
    if (!box) return;
    try {
      const data = await jsonFetch('/app/api/settings/f3-operational-status');
      const current = data.current_round || {};
      const metric = (value) => value?.percent == null ? '—' : value.percent + '%';
      const jobs = [...(data.backfills?.historical_official || []).map((job) => ({ ...job, source: 'Officiell historik' })),
        ...(data.backfills?.xlabs || []).map((job) => ({ ...job, source: job.scope === 'historical_all' ? 'X-Labs historik' : 'X-Labs daglig' }))];
      box.innerHTML = `
        <div class="f3-coverage-grid">
          <div><strong>${esc(current.active_entries ?? '—')}</strong><span>Aktiva starter i nästa omgång</span></div>
          <div><strong>${esc(metric(current.current_start_points))}</strong><span>Start Points</span></div>
          <div><strong>${esc(metric(current.current_entry_equipment))}</strong><span>Utrustning</span></div>
          <div><strong>${esc(metric(current.horses_with_prior_verified_xlabs))}</strong><span>Tidigare verifierad X-Labs</span></div>
        </div>
        <div class="f3-backfill-list">${jobs.length ? jobs.map((job) => `
          <div class="f3-backfill-row"><div><strong>${esc(job.source)}</strong><span>${esc(job.start_date)} – ${esc(job.end_date)} · nästa ${esc(job.next_date || '—')}</span></div><em class="f3-status ${job.status === 'failed' ? 'blocked' : job.status === 'completed' ? 'completed' : 'ready'}">${esc(job.status === 'failed' ? 'Fel' : job.status === 'completed' ? 'Klar' : 'Pågår')}</em></div>
        `).join('') : '<div class="settings-help">Inga backfill-jobb registrerade.</div>'}</div>
        <div class="settings-help">Diagnostiken är skrivskyddad i appen. Återupptagning av jobb kräver det separata administratörsflödet.</div>`;
    } catch (error) {
      box.innerHTML = '<div class="f3-error">Kunde inte läsa driftstatus: ' + esc(error.message) + '</div>';
    }
  }

  function installWorkflow() {
    const layout = document.querySelector('.settings-layout');
    if (!layout || document.getElementById('f3WorkflowCard')) return;
    const existingAi = document.getElementById('sealedStep1V3Card') || layout.querySelector('.settings-section');
    const card = workflowCard();
    layout.insertBefore(card, existingAi || layout.firstChild);
    [...layout.querySelectorAll(':scope > .settings-section')].forEach((section) => {
      if (section !== card && !section.classList.contains('data-coverage-card')) {
        section.dataset.f3LegacyUi = 'hidden';
        section.style.display = 'none';
      }
    });
    document.getElementById('f3Round').addEventListener('change', refreshWorkflow);
    document.getElementById('f3DownloadPack').addEventListener('click', () => {
      const id = roundId(); if (id) download('/app/api/settings/f3-analysis-pack?round_id=' + encodeURIComponent(id));
    });
    document.getElementById('f3CopyStep1').addEventListener('click', (event) => copyText(event.currentTarget, '/app/api/settings/analysis-step1-v3-prompt?provider=' + encodeURIComponent(provider())));
    document.getElementById('f3ImportLock').addEventListener('click', async (event) => {
      const box = document.getElementById('f3Message');
      try {
        await importJsonFile('f3LockFile', '/app/api/settings/analysis-step1-lock?round_id=' + encodeURIComponent(roundId()), event.currentTarget);
        box.className = 'settings-result show success'; box.textContent = 'Steg 1 är förseglat.';
      } catch (error) { box.className = 'settings-result show error'; box.textContent = error.message; }
    });
    document.getElementById('f3DownloadRevision').addEventListener('click', async () => {
      const id = roundId(); if (!id) return;
      const box = document.getElementById('f3Message');
      try {
        await downloadJson('/app/api/settings/analysis-step1-revision?round_id=' + encodeURIComponent(id), 'kentaurai-step1-revision-input.json');
      } catch (error) { box.className = 'settings-result show error'; box.textContent = error.message; }
    });
    document.getElementById('f3CopyRevision').addEventListener('click', (event) => copyText(event.currentTarget, '/app/api/settings/analysis-step1-revision-prompt?provider=' + encodeURIComponent(provider())));
    document.getElementById('f3ImportRevision').addEventListener('click', async (event) => {
      const box = document.getElementById('f3Message');
      try {
        await importJsonFile('f3RevisionFile', '/app/api/settings/analysis-step1-revision?round_id=' + encodeURIComponent(roundId()), event.currentTarget);
        box.className = 'settings-result show success'; box.textContent = 'Steg 1-revisionen är förseglad.';
      } catch (error) { box.className = 'settings-result show error'; box.textContent = error.message; }
    });
    document.getElementById('f3DownloadMarket').addEventListener('click', () => {
      const id = roundId(); if (id) download('/app/api/settings/analysis-market-pack?round_id=' + encodeURIComponent(id));
    });
    document.getElementById('f3CopyStep2').addEventListener('click', (event) => copyText(event.currentTarget, '/app/api/settings/analysis-step2-prompt?provider=' + encodeURIComponent(provider())));
    document.getElementById('f3ImportStep2').addEventListener('click', async (event) => {
      const box = document.getElementById('f3Message');
      try {
        await importJsonFile('f3Step2File', '/app/api/settings/analysis-step2?round_id=' + encodeURIComponent(roundId()), event.currentTarget);
        box.className = 'settings-result show success'; box.textContent = 'Steg 2 är importerat och systemet är optimerat.';
      } catch (error) { box.className = 'settings-result show error'; box.textContent = error.message; }
    });
    loadRounds();
  }

  function installOperational() {
    const layout = document.querySelector('.settings-layout');
    if (!layout || document.getElementById('f3OperationalCard')) return;
    const heading = document.querySelector('.page-head h1')?.textContent || '';
    const hasDataTab = [...document.querySelectorAll('.tab.active')].some((node) => node.textContent.trim() === 'Data');
    if (!hasDataTab && heading !== 'Inställningar') return;
    const section = document.createElement('section');
    section.id = 'f3OperationalCard';
    section.className = 'settings-section settings-card f3-card';
    section.innerHTML = `
      <div class="settings-card-head"><h2>Datatäckning och drift</h2><p>Coverage v2 och backfill-status i läsbar form. Inga råpayloads eller privata källrader visas.</p></div>
      <div class="settings-card-body">
        <div class="settings-actions"><button id="f3CoverageDownload" class="settings-secondary" type="button">Hämta full datatäckningsrapport</button></div>
        <div id="f3OperationalBody" class="f3-operational"><div class="f3-loading">Läser status…</div></div>
      </div>`;
    layout.appendChild(section);
    document.getElementById('f3CoverageDownload').addEventListener('click', () => download('/app/api/settings/data-coverage'));
    loadOperationalStatus();
  }

  function install() {
    const aiTab = [...document.querySelectorAll('.tab.active')].some((node) => node.textContent.trim() === 'AI');
    if (aiTab) installWorkflow();
    const dataTab = [...document.querySelectorAll('.tab.active')].some((node) => node.textContent.trim() === 'Data');
    if (dataTab) installOperational();
  }

  const observer = new MutationObserver(() => queueMicrotask(install));
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  install();
}

const f3Css = `
<style id="kentaurai-f3-private-ui-style">
.f3-card{border-color:#3a3125}.f3-toolbar{margin-bottom:16px}.f3-state{display:grid;border:1px solid var(--line-soft);border-radius:11px;overflow:hidden;margin-bottom:16px}.f3-step-row{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:11px 13px;border-bottom:1px solid var(--line-soft)}.f3-step-row:last-child{border-bottom:0}.f3-step-row strong{font-size:12px;display:block}.f3-step-row span{font-size:10px;color:var(--muted);display:block;margin-top:3px}.f3-status{font-style:normal;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;border:1px solid var(--line);border-radius:999px;padding:5px 8px;white-space:nowrap}.f3-status.completed{color:#a8bda4;border-color:#455743}.f3-status.ready{color:#d0b178;border-color:#665536}.f3-status.blocked{color:#aaa39a}.f3-actions-grid{display:grid;gap:12px}.f3-action{border:1px solid var(--line-soft);border-radius:11px;padding:14px;background:#10100f}.f3-action>strong{font-size:13px}.f3-action>span{display:block;color:var(--muted);font-size:11px;line-height:1.5;margin:4px 0 11px}.f3-import{margin-top:9px}.f3-system{margin-top:14px;border:1px solid #455743;background:#151c14;border-radius:10px;padding:12px}.f3-system strong,.f3-system span{display:block}.f3-system span{font-size:11px;color:#a8bda4;margin-top:3px}.f3-loading,.f3-error{font-size:11px;color:var(--muted);padding:10px}.f3-error{color:#d4a49a}.f3-operational{margin-top:14px}.f3-coverage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.f3-coverage-grid>div{border:1px solid var(--line-soft);border-radius:10px;padding:12px;background:#10100f}.f3-coverage-grid strong{display:block;font-size:20px}.f3-coverage-grid span{display:block;font-size:10px;color:var(--muted);margin-top:3px}.f3-backfill-list{display:grid;margin-top:12px}.f3-backfill-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-soft)}.f3-backfill-row strong{display:block;font-size:12px}.f3-backfill-row span{display:block;font-size:10px;color:var(--muted);margin-top:3px}
@media(max-width:760px){.f3-coverage-grid{grid-template-columns:1fr 1fr}.f3-step-row,.f3-backfill-row{align-items:flex-start}.f3-action .settings-actions{display:grid}.f3-action .settings-primary,.f3-action .settings-secondary,.f3-action .settings-file{width:100%;max-width:none}}
@media(min-width:761px){.f3-actions-grid{grid-template-columns:1fr}.f3-toolbar .settings-field{min-width:240px}}
</style>`;

export function enhanceF3PrivateUiHtml(html) {
  const text = String(html);
  if (text.includes('kentaurai-f3-private-ui-script')) return text;
  return text
    .replace('</head>', `${f3Css}</head>`)
    .replace('</body>', `<script id="kentaurai-f3-private-ui-script">(${f3PrivateUiClient.toString()})();</script></body>`);
}
