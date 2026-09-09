function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderReferenceImportPage({ result = null, error = null } = {}) {
  const summary = result?.summary || {};
  const details = [];
  if (summary.raceCount != null) details.push(`${summary.raceCount} lopp`);
  if (summary.entryCount != null) details.push(`${summary.entryCount} starter`);
  const successMessage = result
    ? `Import klar. ${summary.gameType || 'Referensomgång'}${details.length ? ` · ${details.join(' · ')}` : ''}. Sparad: ${result.reused ? 'redan importerad tidigare' : 'ny import'}.`
    : null;

  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Importera referensomgång · KentaurAI</title>
<style>
:root{color-scheme:dark;--bg:#0d0d0d;--panel:#171614;--line:#302d29;--text:#f4f1eb;--muted:#aaa39a;--accent:#b69b72;--danger:#d58b82;--ok:#9eb28f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:680px;margin:0 auto;padding:28px 18px 48px}.back{display:inline-block;margin-bottom:22px;color:var(--muted);text-decoration:none;font-size:14px}.back:hover{color:var(--text)}h1{margin:0 0 8px;font-size:27px;letter-spacing:-.02em}.lead{margin:0 0 24px;color:var(--muted);line-height:1.5}.card{border:1px solid var(--line);background:var(--panel);border-radius:18px;padding:18px}.file{display:block;width:100%;padding:18px;border:1px dashed #514b43;border-radius:14px;background:#111;color:var(--text)}.actions{display:flex;gap:10px;margin-top:18px}.button{appearance:none;border:0;border-radius:12px;padding:13px 16px;background:var(--accent);color:#15120e;font-weight:700;cursor:pointer}.notice{margin-bottom:16px;border-radius:12px;padding:13px 14px;border:1px solid var(--line);background:#111;line-height:1.45}.notice.ok{border-color:#40503a;color:var(--ok)}.notice.error{border-color:#5e3834;color:var(--danger)}.small{margin-top:18px;color:#7f7971;font-size:12px;line-height:1.5}
</style>
</head>
<body>
<main class="wrap">
<a class="back" href="/app">← Till KentaurAI</a>
<h1>Importera referensomgång</h1>
<p class="lead">Välj en privat <strong>kentaurai-reference-v1</strong>-fil. Filen skickas direkt från din webbläsare till KentaurAI och läggs inte i GitHub.</p>
<section class="card">
${successMessage ? `<div class="notice ok">${esc(successMessage)}</div>` : ''}
${error ? `<div class="notice error">Importen misslyckades: ${esc(error)}</div>` : ''}
<form method="post" action="/app/import/reference-round" enctype="multipart/form-data">
<input class="file" type="file" name="reference_round" accept="application/json,.json" required>
<div class="actions"><button class="button" type="submit">Importera till KentaurAI</button></div>
</form>
<p class="small">Importen validerar format, åtta avdelningar, sannolikheter, systemrader och exakt tre spikar innan data sparas. Max filstorlek: 1 MB.</p>
</section>
</main>
</body>
</html>`;
}
