import { enhanceEntityDetailStatisticsHtmlV2 } from './entity-detail-statistics-ui-v2.js';

const canonicalDetailCss = '<style id="kentaurai-entity-detail-canonical-style">' +
'.entity-detail-bootstrap-skeleton{margin-top:14px}' +
'</style>';

const externalEvidenceCss = '<style id="kentaurai-external-evidence-ui-style">' +
'.external-evidence-groups,.external-interview-list{display:grid;gap:10px}.external-evidence-section{overflow:hidden}.external-evidence-table-wrap{overflow-x:auto}.external-evidence-table{width:100%;border-collapse:collapse}.external-evidence-table th,.external-evidence-table td{padding:10px 12px;border-bottom:1px solid var(--line-soft);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.external-evidence-table th:first-child,.external-evidence-table td:first-child{text-align:left}.external-evidence-table th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:#10100f}.external-evidence-table td{font-size:12px}.external-evidence-table tr:last-child td{border-bottom:0}.external-interview-card{overflow:hidden}.external-interview-card summary{list-style:none;cursor:pointer}.external-interview-card summary::-webkit-details-marker{display:none}.external-interview-row{display:flex;align-items:center;gap:10px;min-height:54px;padding:0 16px}.external-interview-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;font-size:12px;font-weight:700}.external-interview-meta span{white-space:nowrap}.external-interview-sep{color:var(--muted);font-weight:400}.external-interview-arrow{margin-left:auto;color:var(--muted);font-size:18px;line-height:1;transition:transform .16s ease}.external-interview-card[open] .external-interview-arrow{transform:rotate(180deg)}.external-interview-body{border-top:1px solid var(--line-soft);padding:14px 16px 16px}.external-interview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.external-interview-head>span{font-size:10px;color:var(--muted);white-space:nowrap}.external-interview-horse{font-size:10px;color:var(--accent-soft);margin-bottom:2px}.external-interview-summary{font-size:12px;line-height:1.55;color:#c7c0b6;margin-top:10px}.external-interview-change{margin-top:12px;border:1px solid var(--accent-soft);border-radius:9px;padding:9px 10px;font-size:11px;line-height:1.45}.external-interview-change strong{display:block;margin-bottom:3px}.external-signal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.external-signal{border:1px solid var(--line-soft);border-radius:9px;padding:9px 10px;font-size:11px;line-height:1.45}.external-signal-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}.external-signal-head span{font-size:9px;color:var(--muted)}.external-signal-evidence{margin-top:4px;color:var(--muted);font-size:10px}' +
'@media(max-width:620px){.external-interview-row{padding:0 12px}.external-interview-meta{gap:6px;font-size:10px}.external-interview-body{padding:12px}.external-signal-grid{grid-template-columns:1fr}.external-evidence-table th,.external-evidence-table td{padding:9px 7px;font-size:9px}.external-evidence-table th{font-size:7px}}' +
'</style>';

export function enhanceEntityDetailUiHtml(html) {
  const source = String(html);
  let enhanced = enhanceEntityDetailStatisticsHtmlV2(source);
  if (!enhanced.includes('kentaurai-entity-detail-canonical-style')) {
    enhanced = enhanced.replace('</head>', canonicalDetailCss + '</head>');
  }
  if (!enhanced.includes('kentaurai-external-evidence-ui-style')) {
    enhanced = enhanced.replace('</head>', externalEvidenceCss + '</head>');
  }
  return enhanced;
}
