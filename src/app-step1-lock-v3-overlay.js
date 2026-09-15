function step1LockClient() {
  let installedFor = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, { headers: { accept: 'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Begäran misslyckades');
    return data;
  }

  function result(box, message, kind = 'success') {
    box.className = `settings-result show ${kind}`;
    box.textContent = message;
  }

  async function copyPrompt(button) {
    const provider = document.getElementById('sealedStep1Provider')?.value || 'openai';
    const old = button.textContent;
    button.disabled = true;
    try {
      const data = await jsonFetch(`/app/api/settings/analysis-step1-v3-prompt?provider=${encodeURIComponent(provider)}`);
      await navigator.clipboard.writeText(data.prompt);
      button.textContent = '✓ Kopierat';
      setTimeout(() => { button.textContent = old; }, 1600);
    } catch (error) {
      button.textContent = 'Kunde inte kopiera';
      setTimeout(() => { button.textContent = old; }, 1800);
    } finally { button.disabled = false; }
  }

  async function refreshStatus() {
    const roundId = document.getElementById('sealedStep1Round')?.value;
    const box = document.getElementById('sealedStep1Status');
    if (!roundId || !box) return;
    try {
      const data = await jsonFetch(`/app/api/settings/analysis-step1-lock?round_id=${encodeURIComponent(roundId)}`);
      if (!data.lock) {
        box.className = 'settings-code';
        box.textContent = 'Inte låst ännu. Marknadsdata får inte släppas till v3-flödet.';
        return;
      }
      box.className = 'settings-code';
      box.textContent = `Förseglad: ${data.lock.lock_id}\nHash: ${data.lock.lock_hash}\nSkapad: ${data.lock.created_at}`;
    } catch (error) {
      box.className = 'settings-code';
      box.textContent = `Status kunde inte läsas: ${error.message}`;
    }
  }

  async function importLock(button) {
    const roundId = document.getElementById('sealedStep1Round')?.value;
    const file = document.getElementById('sealedStep1File')?.files?.[0];
    const box = document.getElementById('sealedStep1ImportResult');
    if (!roundId) return result(box, 'Välj en omgång först.', 'error');
    if (!file) return result(box, 'Välj kentaurai_step1_locked.json först.', 'error');
    button.disabled = true;
    try {
      const text = await file.text();
      const data = await jsonFetch(`/app/api/settings/analysis-step1-lock?round_id=${encodeURIComponent(roundId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text
      });
      result(box, data.lock?.reused ? 'Steg 1 var redan förseglat med exakt samma innehåll.' : 'Steg 1 är nu förseglat och oföränderligt.');
      await refreshStatus();
    } catch (error) {
      result(box, error.message, 'error');
    } finally { button.disabled = false; }
  }

  async function loadRounds(select) {
    try {
      const data = await jsonFetch('/app/api/settings/analysis-rounds');
      const rounds = (data.rounds || []).filter((round) => round.phase === 'upcoming');
      select.innerHTML = rounds.length
        ? rounds.map((round) => `<option value="${esc(round.id)}">${esc(round.gameType)} ${esc(round.roundDate)} · ${esc((round.tracks || []).join(', '))}</option>`).join('')
        : '<option value="">Ingen kommande komplett V85/V86-omgång</option>';
      await refreshStatus();
    } catch (error) {
      select.innerHTML = '<option value="">Kunde inte läsa omgångar</option>';
    }
  }

  function install() {
    const host = document.querySelector('.settings-layout');
    const legacyStep1 = document.getElementById('exportStep1')?.closest('.settings-section');
    if (!host || !legacyStep1) return;
    if (document.getElementById('sealedStep1V3Card')) return;
    const marker = `${location.pathname}:${Date.now()}`;
    installedFor = marker;
    const section = document.createElement('section');
    section.className = 'settings-section settings-card';
    section.id = 'sealedStep1V3Card';
    section.innerHTML = `
      <div class="settings-card-head">
        <div class="analysis-step-number">V3 · Förseglat Steg 1</div>
        <h2>Lås marknadsblind analys före marknaden</h2>
        <p>Den nya v3-vägen sparar Steg 1 server-side med pack-/faktahash innan någon aktuell marknadsdata får användas. Den äldre combined-v2-vägen finns kvar som legacy tills senare cutover.</p>
      </div>
      <div class="settings-card-body">
        <div class="settings-actions">
          <div class="settings-field"><label for="sealedStep1Round">Omgång</label><select class="settings-select" id="sealedStep1Round"><option value="">Läser omgångar…</option></select></div>
          <div class="settings-field"><label for="sealedStep1Provider">AI</label><select class="settings-select" id="sealedStep1Provider"><option value="openai">ChatGPT</option><option value="anthropic">Claude</option></select></div>
          <button class="settings-secondary" id="sealedStep1CopyPrompt" type="button">Kopiera v3-instruktion</button>
        </div>
        <div class="settings-help">Kör instruktionen endast mot kentaurai-analysis-pack-v3. Den färdiga JSON-filen importeras här innan v3-marknadssteget kan öppnas.</div>
        <div id="sealedStep1Status" class="settings-code">Välj omgång för status.</div>
        <div class="analysis-prompt-guide">
          <h3>Importera förseglat Steg 1</h3>
          <div class="settings-actions">
            <div class="settings-field"><label for="sealedStep1File">Lock-fil</label><input class="settings-file" id="sealedStep1File" type="file" accept="application/json,.json"></div>
            <button class="settings-primary" id="sealedStep1Import" type="button">Försegla Steg 1</button>
          </div>
          <div class="settings-help">Format: <strong>kentaurai-step1-lock-v1</strong>. Exakt retry är idempotent; samma lock-id med ändrat innehåll avvisas.</div>
          <div id="sealedStep1ImportResult" class="settings-result"></div>
        </div>
      </div>`;
    host.insertBefore(section, legacyStep1);
    const round = document.getElementById('sealedStep1Round');
    round.addEventListener('change', refreshStatus);
    document.getElementById('sealedStep1CopyPrompt').addEventListener('click', (event) => copyPrompt(event.currentTarget));
    document.getElementById('sealedStep1Import').addEventListener('click', (event) => importLock(event.currentTarget));
    loadRounds(round);
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById('sealedStep1V3Card')) install();
  });
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  install();
}

export function enhanceStep1LockV3Html(html) {
  const text = String(html);
  if (text.includes('kentaurai-step1-lock-v3-overlay')) return text;
  return text.replace('</body>', `<script id="kentaurai-step1-lock-v3-overlay">(${step1LockClient.toString()})();</script></body>`);
}
