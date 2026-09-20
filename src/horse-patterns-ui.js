const horsePatternsCss = `
<style id="kentaurai-horse-patterns-ui">
.horse-pattern-section{margin-top:14px;border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:13px}.horse-pattern-head{margin-bottom:10px}.horse-pattern-head h2{font-size:13px;margin:0}.horse-pattern-head p{font-size:9px;color:var(--muted);margin:4px 0 0;line-height:1.45}.horse-pattern-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.horse-pattern-card{border:1px solid var(--line-soft);border-radius:9px;padding:10px;min-width:0}.horse-pattern-card span{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.horse-pattern-card strong{display:block;font-size:15px;margin-top:4px;color:var(--text);font-variant-numeric:tabular-nums}.horse-pattern-card small{display:block;font-size:8px;line-height:1.4;color:var(--muted);margin-top:4px}.horse-pattern-positive{color:var(--accent-soft)!important}.horse-pattern-empty{font-size:10px;color:var(--muted);padding:4px 0}
@media(max-width:760px){.horse-pattern-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:380px){.horse-pattern-grid{grid-template-columns:1fr}}
</style>`;

export function enhanceHorsePatternsHtml(html) {
  const text = String(html);
  if (text.includes('kentaurai-horse-patterns-ui')) return text;
  return text.replace('</head>', `${horsePatternsCss}</head>`);
}
