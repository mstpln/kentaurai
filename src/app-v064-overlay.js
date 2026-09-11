import { RACE_TYPE_OPTIONS } from './race-classification.js';

const css = `
<style id="kentaurai-v064-overlay">
.analysis-prompt-guide{margin-top:16px;padding-top:15px;border-top:1px solid var(--line-soft)}
.analysis-prompt-guide h3{font-size:14px;font-weight:650;margin:0 0 6px}
.analysis-prompt-guide p{font-size:12px;line-height:1.55;color:var(--muted);margin:0 0 12px}
.analysis-prompt-copy{width:auto}
@media(max-width:620px){.analysis-prompt-copy{width:100%}}
</style>`;

function v064Client(RACE_TYPE_OPTIONS) {
  const originalFetch = window.fetch.bind(window);
  const exactText = new Map([
    ['spike_miss', 'Missad spik'], ['coverage_miss', 'Vinnaren saknades på systemet'],
    ['Learnings', 'Lärdomar'], ['Omgångens learnings', 'Omgångens lärdomar'],
    ['Inga registrerade learnings för omgången ännu.', 'Inga registrerade lärdomar för omgången ännu.'],
    ['Miss', 'Fel'], ['Vår rank', 'Vår rankning'], ['Marknadsrank', 'Marknadsrankning'], ['Auto', 'Autostart'],
    ['pre_market', 'Förhandsanalys'], ['final', 'Slutanalys'],
    ['normalized_verified_subset', 'Verifierad delmängd'], ['captured_unmapped', 'Infångad, ej normaliserad'],
    ['unknown', 'Okänd'], ['X-Labs segment', 'X-Labs-segment'],
    ['Main Class', 'Loppklass'], ['Main class', 'Loppklass'], ['Huvudklass', 'Loppklass'],
    ['Class Flags', 'Loppkategorier'], ['Class flags', 'Loppkategorier'], ['Klassflaggor', 'Loppkategorier']
  ]);
  const fieldLabels = new Map([
    ['Actual Distance M', 'Faktisk distans'], ['Actual Distance', 'Faktisk distans'], ['actualDistanceM', 'Faktisk distans'],
    ['actual_distance_m', 'Faktisk distans'], ['Extra Distance M', 'Extra distans'], ['Extra Distance', 'Extra distans'],
    ['extraDistanceM', 'Extra distans'], ['extra_distance_m', 'Extra distans'],
    ['Converted Km Time', 'Omräknad km-tid'], ['convertedKmTime', 'Omräknad km-tid'], ['converted_km_time', 'Omräknad km-tid'],
    ['Leader', 'Spets'], ['leader', 'Spets'], ['Pocket', 'Rygg ledaren'], ['pocket', 'Rygg ledaren'],
    ['Death Seat', 'Dödens'], ['deathSeat', 'Dödens'], ['death_seat', 'Dödens'],
    ['Second Over', '2:a utvändigt'], ['secondOver', '2:a utvändigt'], ['second_over', '2:a utvändigt'],
    ['Third Over', '3:e utvändigt'], ['thirdOver', '3:e utvändigt'], ['third_over', '3:e utvändigt'],
    ['Wide Trip', 'Brett spår'], ['wideTrip', 'Brett spår'], ['wide_trip', 'Brett spår'],
    ['Uncovered Move', 'Attack utan rygg'], ['uncoveredMove', 'Attack utan rygg'], ['uncovered_move', 'Attack utan rygg'],
    ['Traffic Event', 'Loppincident'], ['trafficEvent', 'Loppincident'], ['traffic_event', 'Loppincident'],
    ['Summary', 'Sammanfattning'], ['summary', 'Sammanfattning'], ['Position', 'Position'], ['position', 'Position'],
    ['Lane', 'Spår'], ['lane', 'Spår'], ['Observed At M', 'Mätpunkt'], ['observedAtM', 'Mätpunkt'], ['observed_at_m', 'Mätpunkt']
  ]);
  const countries = { SE: 'Sverige', NO: 'Norge', DK: 'Danmark', FI: 'Finland', DE: 'Tyskland', FR: 'Frankrike', IT: 'Italien', NL: 'Nederländerna', BE: 'Belgien', EE: 'Estland', LV: 'Lettland', LT: 'Litauen', US: 'USA', CA: 'Kanada' };

  function replaceNodeText(node, map) {
    const raw = node.textContent;
    const trim = raw.trim();
    if (map.has(trim)) node.textContent = raw.replace(trim, map.get(trim));
    else if (/^rank\s+\d+$/i.test(trim)) node.textContent = raw.replace(trim, trim.replace(/^rank/i, 'rankning'));
  }
  function normalizeClassFlagField(label) {
    const raw = label.textContent.trim();
    if (!['Class Flags', 'Class flags', 'Klassflaggor', 'Loppkategorier'].includes(raw)) return;
    const item = label.closest('.data-item');
    const value = item?.querySelector('.data-value');
    if (!item || !value) return;
    label.textContent = 'Loppkategorier';
    let text = value.textContent;
    for (const [key, name] of RACE_TYPE_OPTIONS) text = text.replaceAll(key, name);
    value.textContent = text;
  }
  function localizeTechnicalAnalysisHeadings() {
    document.querySelectorAll('.data-section').forEach((section) => {
      const heading = section.querySelector('.data-section-head h2')?.textContent.trim();
      section.querySelectorAll('.analysis-head strong').forEach((strong) => {
        const text = strong.textContent.trim();
        if (heading === 'Redaktionella signaler' && /(^|\s)[a-z0-9]+_[a-z0-9_]+($|\s)/i.test(text)) strong.textContent = 'Redaktionell signal';
        if (heading === 'Lagrade AI-bedömningar' && /^[a-z0-9]+_[a-z0-9_]+/i.test(text)) {
          const suffix = text.includes(' · ') ? ' · ' + text.split(' · ').slice(1).join(' · ') : '';
          strong.textContent = 'AI-analys' + suffix;
        }
      });
    });
  }
  function localizeVisible() {
    const app = document.getElementById('app');
    if (!app) return;
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        return ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA'].includes(tag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) replaceNodeText(node, exactText);
    document.querySelectorAll('.data-label').forEach(normalizeClassFlagField);
    document.querySelectorAll('.data-label,.history-fact-label,.coverage-label,.structured-key').forEach((element) => replaceNodeText(element, fieldLabels));
    document.querySelectorAll('.data-value').forEach((element) => {
      const text = element.textContent.trim();
      if (countries[text]) element.textContent = countries[text];
    });
    document.querySelectorAll('.detail-meta').forEach((element) => {
      let text = element.textContent;
      for (const [code, name] of Object.entries(countries)) text = text.replace(new RegExp(' · ' + code + '$'), ' · ' + name);
      element.textContent = text;
    });
    document.querySelectorAll('.settings-count span').forEach((element) => {
      if (element.textContent.trim() === 'Spel') element.textContent = 'V85/V86-omgångar';
    });
    localizeTechnicalAnalysisHeadings();
  }

  function enhanceAnalysisImportGuide() {
    const head = [...document.querySelectorAll('.settings-card-head h2')].find((element) => element.textContent.trim() === 'Importera AI-analys');
    if (!head) return;
    const card = head.closest('.settings-card');
    const body = card?.querySelector('.settings-card-body');
    if (!body || body.querySelector('.analysis-prompt-guide')) return;
    body.querySelector('.settings-help')?.remove();
    body.querySelector('.settings-code')?.remove();
    const result = body.querySelector('#analysisImportResult');
    const guide = document.createElement('div');
    guide.className = 'analysis-prompt-guide';
    guide.innerHTML = '<h3>Skapa V85/V86-systemanalysfil för import</h3><p>Kopiera instruktionerna och klistra in dem i samma ChatGPT- eller Claude-konversation där analysen och systemet skapades. AI:n skapar då en JSON-fil som är färdig att importera i KentaurAI.</p><button type="button" class="settings-secondary analysis-prompt-copy">Kopiera instruktioner till AI</button>';
    body.insertBefore(guide, result || null);
    const button = guide.querySelector('button');
    button.onclick = async () => {
      const old = button.textContent;
      button.disabled = true;
      try {
        const provider = document.getElementById('exportProvider')?.value || 'ai';
        const response = await originalFetch('/app/api/settings/analysis-prompt?provider=' + encodeURIComponent(provider), { headers: { accept: 'application/json' } });
        const data = await response.json();
        if (!response.ok || !data.prompt) throw new Error(data.message || 'Kunde inte läsa instruktionerna');
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(data.prompt);
        else {
          const area = document.createElement('textarea');
          area.value = data.prompt;
          area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
        }
        button.textContent = '✓ Kopierat'; setTimeout(() => { button.textContent = old; }, 1800);
      } catch {
        button.textContent = 'Kunde inte kopiera'; setTimeout(() => { button.textContent = old; }, 1800);
      } finally { button.disabled = false; }
    };
  }

  function enhance() { localizeVisible(); enhanceAnalysisImportGuide(); }
  const observer = new MutationObserver(enhance);
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  enhance();
}

function browserScript() {
  return `<script id="kentaurai-v064-overlay-script">(${v064Client.toString()})(${JSON.stringify(RACE_TYPE_OPTIONS)});</script>`;
}

export function enhanceAppHtmlV064(html) {
  return String(html)
    .replace('</head>', () => `${css}</head>`)
    .replace('</body>', () => `${browserScript()}</body>`);
}
