export const travdataThemeCss = `
<style id="travdata-brand-theme">
:root{
  color-scheme:light;
  --bg:#F7F7FC;--panel:#FFFFFF;--panel2:#F2F1F9;--surface:#FFFFFF;
  --line:#E4E4EF;--line-soft:#ECECF4;--text:#010127;--muted:#62627B;--muted2:#77778D;
  --accent:#8E31FD;--accent-soft:#6D20C4;--beige:#8E31FD;--blue:#0001FD;
  --green:#28784B;--red:#F70506;--shadow:0 12px 32px rgba(18,15,54,.10);
  --travdata-title-size:28px;--travdata-subtitle-size:16px;
  --font-ui:Helvetica,Arial,sans-serif;--font-brand:Helvetica,Arial,sans-serif;--font-mono:Helvetica,Arial,sans-serif
}
html,body{background:#F7F7FC!important;color:#010127!important;font-family:Helvetica,Arial,sans-serif!important}
body{color-scheme:light}
button,input,select,textarea{font-family:Helvetica,Arial,sans-serif}
.login{background:#FFFFFF!important;border-color:#E4E4EF!important;box-shadow:0 20px 60px rgba(18,15,54,.08)!important}
.login input{background:#FFFFFF!important;color:#010127!important;border-color:#E4E4EF}
.login button{background:#8E31FD!important;color:#FFFFFF!important}
.login .note{color:#62627B}
.metric,.p1-stat-value,.p1-finance-card strong,.p1-number,.table{font-variant-numeric:tabular-nums}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.p1-focus:focus-visible{outline-color:#6D20C4!important}

/* One page-heading scale for Trend, statistics categories and the Spel views. */
.page-heading,.start-heading,.p1-page-head{margin-bottom:24px!important}
.page-heading h1,.start-heading h1,.p1-page-head h1{
  font-family:Helvetica,Arial,sans-serif!important;font-size:var(--travdata-title-size)!important;
  font-weight:700!important;line-height:1.2!important;letter-spacing:-.02em!important;
  margin:0!important;white-space:normal;overflow-wrap:normal
}
.page-heading p,.start-heading p,.p1-page-head p{
  font-family:Helvetica,Arial,sans-serif!important;font-size:var(--travdata-subtitle-size)!important;
  font-weight:400!important;line-height:1.4!important;margin:8px 0 0!important
}

/* Preserve the round artwork; only TRAVDATA becomes live Helvetica text. */
.brand{min-width:0}
.travdata-brand{--travdata-logo-size:30px;display:flex;align-items:center;gap:8px;white-space:nowrap}
.topbar .travdata-brand{gap:4px!important}
.travdata-brand img{display:block;flex:none;object-fit:contain}
.travdata-logo-mark{width:var(--travdata-logo-size);height:var(--travdata-logo-size)}
.travdata-wordmark{display:block;flex:none;height:var(--travdata-logo-size);font:italic 700 calc(var(--travdata-logo-size)*.9605)/var(--travdata-logo-size) Arial,Helvetica,sans-serif;letter-spacing:-.04em;white-space:nowrap}
.travdata-word-trav{color:#F70506}.travdata-word-data{color:#8E31FD}
.login .travdata-brand{--travdata-logo-size:32px}
.brand-badge,.brand-icon,.brand-name{display:none!important}

.topbar,.bottom-nav{background:rgba(247,247,252,.97)!important;border-color:#E4E4EF!important}
.topbar{background:#010127!important;border-color:#242449!important}
.topbar .search-shell{background:#0D0D3F!important;border-color:#30305A!important}
.topbar .search{background:transparent!important;color:#FFFFFF!important;border-color:#30305A!important}
.topbar .search::placeholder{color:#B9B9D0!important}
.topbar .search-prefix,.topbar .search-clear{color:#D8D8EA!important}
.topbar .search-divider{background:#3A3A62!important}
.topbar #settingsButton{background:transparent!important;color:#0001FD!important;border-color:transparent!important}
.topbar #settingsButton.active{background:rgba(0,1,253,.20)!important;color:#0001FD!important}
.topbar{backdrop-filter:blur(18px)}
.bottom-nav{backdrop-filter:blur(18px)}
.main,.shell{color:#010127}
.search,.p1-button,.p1-select,.p1-input,.p1-textarea,.p1-filter,.segment-btn,.range-btn,.sort-btn,.system-btn,
.p1-leg-tab,.p1-horse,.p1-expand-btn,.p1-number,.p1-system-head,.pager-btn,.back,.logout,.settings-button,
.settings-file,.settings-secondary,.stat-pill,.entity-detail-scope,.entity-detail-field select,
.trainer-stats-filter select,.horse-stats-filter select,.driver-stats-filter select{
  background-color:#FFFFFF!important;border-color:#E4E4EF!important;color:#010127!important
}
.search::placeholder{color:#77778D!important}
.p1-horse .p1-expand-btn{background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0;padding:0;display:grid;place-items:center;font-size:14px;line-height:1}
.search:focus,.p1-button:focus,.p1-input:focus,.p1-select:focus,.p1-textarea:focus{border-color:#8E31FD!important}
.search-prefix,.search-clear,.logout,.back,.settings-button{color:#62627B!important}
.search-divider{background:#E4E4EF!important}
.search-results,.trend-sort-menu,.p1-modal,.settings-card,.settings-source-card,.settings-section,
.card,.p1-card,.p1-stat-card,.p1-detail-figure,.p1-result-leg,.entity-detail-special,
.trainer-special,.horse-special,.driver-special,.trainer-ranking-card,.horse-ranking-card,.driver-ranking-card,
.entity-detail-table-wrap,.trend-panel,.analysis-card,.data-section,.start-card,.external-evidence-section,
.external-interview-card,.learning-item,.p1-note-card,.p1-editor,.p1-preview,.p1-settings-row,
.entity-detail-score,.entity-detail-hero,.p1-performance .p1-card{
  background:#FFFFFF!important;border-color:#E4E4EF!important;box-shadow:0 5px 16px rgba(18,15,54,.035)
}
.trend-panel,.entity-detail-score{background:#FFFFFF!important}
.trend-panel-head,.trend-result-row,.trend-result-row:hover,.trainer-ranking-row:hover,.horse-ranking-row:hover,
.driver-ranking-row:hover,.entity-row:hover,.game-row:hover,.p1-round:hover,.p1-saved-round-head:hover,
.search-item:hover,.p1-system-head,.p1-horse-expanded,.p1-stat-card,.p1-number,.analysis-card,
.table th,.p1-history-table th,
.trend-category-tabs .segment-btn{
  background-color:#F2F1F9!important
}
.trend-category-tabs,.statistics-category-nav,.p1-spel-switcher{
  background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important;color:#FFFFFF!important
}
.trend-category-tabs .segment-btn,.statistics-category-nav .statistics-category-btn,
.p1-spel-switcher .p1-filter{
  background:#010127!important;border-color:rgba(255,255,255,.20)!important;color:#FFFFFF!important
}
.trend-category-tabs .segment-btn.active,.statistics-category-nav .statistics-category-btn.active,
.p1-spel-switcher .p1-filter.active{
  background:#0001FD!important;border-color:#0001FD!important;color:#FFFFFF!important
}
.entity-detail-toolbar,.trend-scope-line{background:transparent!important;color:#010127!important}
.entity-detail-year select,.trend-period-select,
.entity-detail-filter-toggle,.trend-detail-trigger{background:transparent!important}
.trend-panel,.trend-panel-head,.trend-result-row,.entity-row,.game-row,.table th,.table td,
.entity-detail-table th,.entity-detail-table td,.p1-history-table th,.p1-history-table td,
.p1-run-row,.p1-systems,.p1-system-detail,.p1-horse-expanded,.p1-stat-card,
.p1-summary-grid,.facts,.p1-detail-figure,.p1-result-leg,.data-item,.structured-item{
  border-color:#E4E4EF!important
}
.search-results,.period-badge,.entity-detail-special-grid div,.trainer-special-metric,.horse-special-metric,
.driver-special-metric,.entity-detail-table-wrap,.p1-system,.p1-detail-figure,.p1-result-leg{
  border-color:#E4E4EF!important
}
.card,.p1-card,.settings-card,.settings-source-card,.entity-detail-special,.trainer-ranking-card,
.horse-ranking-card,.driver-ranking-card,.trainer-special,.horse-special,.driver-special,
.entity-detail-table-wrap,.p1-horse,.p1-system,.p1-note-card,.p1-editor,.analysis-card,
.trend-panel,.data-section,.start-card,.external-interview-card,.external-evidence-section{
  border-color:#E4E4EF!important
}

.page-heading h1,.start-heading h1,.p1-page-head h1,.detail-name,.metric,.score,.card-title,.section-title h2,
.entity-name,.game-title,.trend-panel-head h2,.trend-result-name,.p1-round-name,.p1-horse-name,
.p1-stat-value,.p1-finance-card strong,.p1-summary-item strong,.p1-detail-figure strong,
.p1-settings-row strong,.p1-run-row strong,.trainer-ranking-name,.horse-ranking-name,.driver-ranking-name,
.settings-card-head,.settings-card-body,.table td,.p1-history-table td,.entity-detail-table td,
.entity-detail-special h3,.trainer-special h2,.horse-special h2,.driver-special h2{color:#010127}
.muted,.metric-note,.page-heading p,.start-heading p,.filter-label,.filter-label,.p1-muted,.p1-small,
.p1-label,.p1-round-meta,.p1-horse-driver,.p1-horse-metric small,.p1-stat-label,.p1-stat-note,
.p1-settings-row small,.p1-run-row small,.p1-settings-row time,.p1-run-row time,
.entity-detail-label,.entity-detail-sub,.entity-detail-mini span,.entity-detail-mini small,
.entity-detail-strip span,.entity-detail-field label,.entity-detail-head span,.entity-detail-special p,
.table th,.entity-detail-table th,.trainer-ranking-note,.horse-ranking-note,.driver-ranking-note,
.trainer-ranking-empty,.horse-ranking-empty,.driver-ranking-empty{color:#62627B}
.eyebrow,.trend-panel-kicker,.trend-panel-period,.trend-type,.search-type,.link,.profile-horse-name,
.entity-detail-win,.entity-detail-year select,.entity-detail-filter-count,.trainer-stats-period select,
.horse-stats-period select,.driver-stats-period select,.trend-period-select,.trend-filter-count,
.trainer-stats-filter-count,.horse-stats-filter-count,.driver-stats-filter-count,.p1-kicker,
.p1-market,.p1-game,.p1-note-meta,.p1-note-dot,.p1-spike,.p1-horse-num{color:#6D20C4!important}
.tabs{border-color:#E4E4EF!important}
.tab{color:#62627B!important}
.tab.active{color:#010127!important}
.tab.active:after{background:#0001FD!important}
.segment-btn.active,.range-btn.active,.sort-btn.active,.system-btn.active,.p1-filter.active,
.p1-leg-tab.active,.p1-number.selected,.stat-pill.active,.entity-detail-scope.active{
  background:#8E31FD!important;border-color:#8E31FD!important;color:#FFFFFF!important
}
.p1-leg-tab.active strong,.p1-leg-tab.active span{color:#FFFFFF!important}
.p1-button.primary,.settings-primary{background:#8E31FD!important;border-color:#8E31FD!important;color:#FFFFFF!important}
.p1-button:hover,.p1-filter:hover,.segment-btn:hover,.range-btn:hover,.sort-btn:hover,.system-btn:hover,
.pager-btn:hover,.settings-secondary:hover{border-color:#8E31FD!important}
.nav-item{color:#62627B!important}
.nav-item:hover{color:#010127!important}
/* The top gear is the only icon intentionally recolored; bottom-nav icons are unchanged. */
.topbar #settingsButton svg{color:#0001FD!important}
.nav-item.active{color:#6D20C4!important;background:rgba(142,49,253,.09)!important}
.trend-result-row,.entity-row,.game-row,.profile-horse-row,.trainer-ranking-row,.horse-ranking-row,.driver-ranking-row{
  color:#010127!important;border-color:#E4E4EF!important
}
.trend-result-row:hover,.entity-row:hover,.game-row:hover,.trainer-ranking-row:hover,.horse-ranking-row:hover,.driver-ranking-row:hover{background:#F2F1F9!important}
.avatar{background:#F2F1F9!important;border-color:#E4E4EF!important;color:#6D20C4!important}
.p1-chip,.trip-chip,.learning-chip{background:#F2F1F9!important;border-color:#E4E4EF!important;color:#62627B!important}
.trend-metric-pill{background:#FFFFFF!important;border-color:#E4E4EF!important;color:#010127!important}
.p1-form{color:#62627B}
.p1-game{background:#F2F1F9!important;border-color:#E4E4EF!important}
.synthetic-preview-badge{background:#F3EAFE!important;border-color:#8E31FD!important;color:#6D20C4!important;box-shadow:0 2px 8px rgba(18,15,54,.08)!important}
.p1-chip.demo{background:#F2F1F9!important;border-color:#8E31FD!important;color:#6D20C4!important}
.p1-game.v86{background:#F2F1F9!important;border-color:#E4E4EF!important;color:#62627B!important}
.p1-notice,.notice{background:#F2F1F9!important;border-color:#D7D5E6!important;color:#35354D!important}
.p1-error,.error,.settings-result.error{background:#FFF1F1!important;border-color:#F70506!important;color:#A30A12!important}
.settings-result.success,.p1-settings-state{background:#EDF7F0!important;border-color:#B8D8C2!important;color:#28784B!important}
.p1-settings-state.error{background:#FFF1F1!important;border-color:#F70506!important;color:#A30A12!important}
.score.good,.outcome-good,.p1-result-win,.p1-positive,.p1-result-winner{color:#28784B!important}
.score.bad,.outcome-bad,.p1-result-dq,.p1-negative,.p1-result-missed{color:#C51C25!important}
.p1-gallop{color:#B86608!important}
.p1-result-pending,.p1-neutral,.outcome-neutral{color:#62627B!important}
.p1-mini-track,.mini-track{background:#E4E4EF!important}
.mini-fill{background:#8E31FD!important}
.skeleton,.p1-loading-line,.entity-detail-bootstrap-skeleton,.entity-detail-loading,.trend-loading{
  background:linear-gradient(90deg,#F0EFF7,#E5E3F0,#F0EFF7)!important;background-size:200% 100%!important
}
.p1-modal-backdrop{background:rgba(1,1,39,.36)!important}
.settings-code,.json-block{background:#F2F1F9!important;border-color:#E4E4EF!important;color:#35354D!important}
.settings-alert-badge{border-color:#F7F7FC!important}
.p1-synthetic-banner{color:#6D20C4!important}
.empty,.trend-empty,.trend-no-data,.entity-detail-empty{color:#62627B}
.empty strong,.trend-empty h3,.trend-no-data strong{color:#010127}
@media(max-width:767px){
 :root{--travdata-title-size:24px;--travdata-subtitle-size:14px}
}
@media(max-width:760px){
 .travdata-brand{--travdata-logo-size:29px;gap:6px}
}
@media(max-width:430px){
 .travdata-brand{--travdata-logo-size:28px}
}
</style>`;
