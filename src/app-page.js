function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Interface icons are adapted from Phosphor Icons (MIT).
const iconPaths = {
  horse: 'M136,100a12,12,0,1,1-12-12A12,12,0,0,1,136,100Zm96,29.48A104.29,104.29,0,0,1,130.1,232l-2.17,0a103.32,103.32,0,0,1-69.26-26A8,8,0,1,1,69.34,194a84.71,84.71,0,0,0,20.1,13.37L116,170.84c-22.78-9.83-47.47-5.65-61.4-3.29A31.84,31.84,0,0,1,23.3,154.72l-.3-.43-13.78-22a8,8,0,0,1,2.59-11.05L112,59.53V32a8,8,0,0,1,8-8h8A104,104,0,0,1,232,129.48Zm-16-.22A88,88,0,0,0,128,40V64a8,8,0,0,1-3.81,6.81L27.06,130.59l9.36,15A15.92,15.92,0,0,0,52,151.77c16-2.7,48.77-8.24,78.07,8.18A40.06,40.06,0,0,0,168,120a8,8,0,0,1,16,0,56.07,56.07,0,0,1-51.8,55.83l-27.11,37.28A90.89,90.89,0,0,0,129.78,216,88.29,88.29,0,0,0,216,129.26Z',
  trend: 'M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z',
  trainer: 'M144,157.68a68,68,0,1,0-71.9,0c-20.65,6.76-39.23,19.39-54.17,37.17a8,8,0,1,0,12.24,10.3C50.25,181.19,77.91,168,108,168s57.75,13.19,77.87,37.15a8,8,0,0,0,12.26-10.3C183.18,177.07,164.6,164.44,144,157.68ZM56,100a52,52,0,1,1,52,52A52.06,52.06,0,0,1,56,100Zm196.25,43.07-4.66-2.69a23.6,23.6,0,0,0,0-8.76l4.66-2.69a8,8,0,1,0-8-13.86l-4.67,2.7a23.92,23.92,0,0,0-7.58-4.39V108a8,8,0,0,0-16,0v5.38a23.92,23.92,0,0,0-7.58,4.39l-4.67-2.7a8,8,0,1,0-8,13.86l4.66,2.69a23.6,23.6,0,0,0,0,8.76l-4.66,2.69a8,8,0,0,0,8,13.86l4.67-2.7a23.92,23.92,0,0,0,7.58,4.39V164a8,8,0,0,0,16,0v-5.38a23.92,23.92,0,0,0,7.58-4.39l4.67,2.7a7.92,7.92,0,0,0,4,1.07,8,8,0,0,0,4-14.93ZM216,136a8,8,0,1,1,8,8A8,8,0,0,1,216,136Z',
  driver: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24ZM74.08,197.5a64,64,0,0,1,107.84,0,87.83,87.83,0,0,1-107.84,0ZM96,120a32,32,0,1,1,32,32A32,32,0,0,1,96,120Zm97.76,66.41a79.66,79.66,0,0,0-36.06-28.75,48,48,0,1,0-59.4,0,79.66,79.66,0,0,0-36.06,28.75,88,88,0,1,1,131.52,0Z',
  search: 'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
  close: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z'
};

function icon(name, className = 'icon') {
  return `<svg class="${className}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${iconPaths[name]}"/></svg>`;
}

function brand() {
  return `<div class="brand"><span class="brand-badge">${icon('horse', 'brand-icon')}</span><div class="brand-name">KENTAUR<span>AI</span></div></div>`;
}

export function renderLoginPage({ error = false } = {}) {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0b0a">
<title>KentaurAI</title>
<style>
:root{--bg:#0b0b0a;--panel:#151412;--line:#2b2823;--text:#f2eee6;--muted:#958f86;--gold:#cfa35f;--font-ui:"Avenir Next",Avenir,"Helvetica Neue",Arial,sans-serif;--font-brand:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 10%,#211d17 0,#0b0b0a 50%);font:15px/1.5 var(--font-ui);color:var(--text);padding:24px}.login{width:min(420px,100%);background:rgba(21,20,18,.96);border:1px solid var(--line);border-radius:18px;padding:30px;box-shadow:0 28px 80px rgba(0,0,0,.42)}.brand{display:flex;align-items:center;gap:11px;margin-bottom:32px}.brand-badge{width:38px;height:38px;border:1px solid var(--gold);border-radius:50%;display:grid;place-items:center;color:var(--gold)}.brand-icon{width:23px;height:23px}.brand-name{font:800 22px/1 var(--font-brand);letter-spacing:.08em}.brand-name span{color:var(--gold)}h1{font-size:21px;margin:0 0 7px;font-weight:650}p{color:var(--muted);margin:0 0 23px}label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:8px}input{width:100%;border:1px solid var(--line);background:#0e0e0d;color:var(--text);border-radius:12px;padding:14px 15px;font:inherit;outline:none}input:focus{border-color:var(--gold)}button{width:100%;margin-top:14px;border:0;border-radius:12px;background:var(--gold);color:#17120d;padding:14px;font:650 15px var(--font-ui);cursor:pointer}.error{padding:10px 12px;border:1px solid #6d4b35;background:#2b1d16;color:#f2c7a9;border-radius:12px;margin-bottom:15px;font-size:13px}.note{font-size:12px;color:#777168;margin-top:18px}
</style>
</head>
<body>
<form class="login" method="post" action="/app/login" autocomplete="off">
  ${brand()}
  <h1>Privat åtkomst</h1>
  <p>Logga in för att öppna din KentaurAI-databas.</p>
  ${error ? '<div class="error">Fel lösenord.</div>' : ''}
  <label for="password">Lösenord</label>
  <input id="password" name="password" type="password" required autofocus>
  <button type="submit">Öppna KentaurAI</button>
  <div class="note">Enheten hålls inloggad i upp till 30 dagar.</div>
</form>
</body>
</html>`;
}

export function renderAppPage() {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0b0a">
<title>KentaurAI</title>
<style>
:root{
  --bg:#0b0b0a;--panel:#131311;--panel2:#181714;--line:#282620;--line-soft:#201f1b;
  --text:#f2eee6;--muted:#989188;--muted2:#706b64;--gold:#cfa35f;--gold-soft:#d9bb87;
  --beige:#ded2bf;--blue:#667e95;--yellow:#c9b154;--radius:14px;--shadow:0 18px 50px rgba(0,0,0,.3);
  --font-ui:"Avenir Next",Avenir,"Helvetica Neue",Arial,sans-serif;--font-brand:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.48 var(--font-ui);min-height:100vh;font-weight:450}button,input{font:inherit}button:focus{outline:none}button:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}.shell{min-height:100vh;padding-bottom:92px}
.topbar{position:sticky;top:0;z-index:40;background:rgba(11,11,10,.96);backdrop-filter:blur(18px);border-bottom:1px solid var(--line-soft)}.top-inner{max-width:1240px;margin:auto;padding:12px 20px;display:grid;grid-template-columns:auto minmax(280px,680px) auto;align-items:center;gap:24px}.brand{display:flex;align-items:center;gap:10px;min-width:max-content}.brand-badge{width:35px;height:35px;border:1px solid var(--gold);border-radius:50%;display:grid;place-items:center;color:var(--gold)}.brand-icon{width:21px;height:21px}.brand-name{font:800 19px/1 var(--font-brand);letter-spacing:.08em}.brand-name span{color:var(--gold)}
.search-wrap{position:relative}.search-shell{position:relative}.search{width:100%;height:46px;border-radius:12px;border:1px solid var(--line);background:#151513;color:var(--text);padding:0 46px 0 74px;font:500 15px/1 var(--font-ui);outline:none}.search::placeholder{color:#77726b}.search:focus{border-color:#625642;background:#181714}.search-prefix{position:absolute;left:15px;top:50%;transform:translateY(-50%);z-index:2;display:flex;align-items:center;gap:14px;color:#a69f95;pointer-events:none}.search-icon{width:20px;height:20px;display:block}.search-divider{width:1px;height:22px;background:#403d36;display:block}.search-clear{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#8c867e;cursor:pointer;padding:6px}.search-clear:hover{color:var(--text);background:#201f1c}.clear-icon{width:17px;height:17px;display:block}.logout{border:1px solid var(--line);background:transparent;color:#a39c92;border-radius:10px;padding:9px 13px;cursor:pointer}.logout:hover{color:var(--text);border-color:#3b382f}.search-results{position:absolute;left:0;right:0;top:52px;background:#171715;border:1px solid var(--line);border-radius:13px;box-shadow:var(--shadow);overflow:hidden;display:none}.search-results.open{display:block}.search-item{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line-soft);cursor:pointer}.search-item:last-child{border-bottom:0}.search-item:hover{background:#1d1c19}.search-type{color:var(--gold-soft);font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:650}
.main{max-width:1160px;margin:auto;padding:34px 20px}.page-heading{margin-bottom:22px}.page-heading h1,.start-heading h1{font-size:29px;line-height:1.12;letter-spacing:-.025em;margin:0;font-weight:650}.page-heading p,.start-heading p{margin:7px 0 0;color:var(--muted);font-size:14px}.start-heading{margin-bottom:26px}.eyebrow{color:var(--gold-soft);font-size:10px;text-transform:uppercase;letter-spacing:.14em;font-weight:700}
.tabs{display:flex;gap:24px;border-bottom:1px solid var(--line);max-width:100%;overflow:auto;margin-bottom:22px;scrollbar-width:none}.tab{position:relative;border:0;background:transparent;color:#8e887f;padding:0 0 11px;white-space:nowrap;font-weight:550;cursor:pointer}.tab.active{color:var(--text)}.tab.active:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--gold)}
.trend-filters{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:26px;align-items:end;margin-bottom:20px}.filter-block{min-width:0}.filter-label{font-size:10px;text-transform:uppercase;letter-spacing:.11em;color:#777168;font-weight:650;margin-bottom:8px}.segment-group,.range-group{display:flex;gap:6px;flex-wrap:wrap}.segment-btn,.range-btn{border:1px solid var(--line);background:#11110f;color:#938d84;border-radius:9px;padding:9px 13px;cursor:pointer;font-size:13px;font-weight:550}.segment-btn:hover,.range-btn:hover{border-color:#3a372f;color:var(--text)}.segment-btn.active{background:var(--beige);border-color:var(--beige);color:#171411}.range-btn.active{background:#231e17;border-color:#6a5336;color:var(--gold-soft)}
.trend-panel{background:linear-gradient(180deg,#141412 0,#11110f 100%);border:1px solid var(--line);border-radius:16px;overflow:hidden}.trend-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:20px 22px;border-bottom:1px solid var(--line-soft)}.trend-panel-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--gold-soft);font-weight:700}.trend-panel-head h2{font-size:19px;font-weight:600;margin:4px 0 0;letter-spacing:-.015em}.period-badge{font-size:12px;color:#a39c92;border:1px solid var(--line);border-radius:999px;padding:6px 10px;white-space:nowrap}.trend-empty{min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:38px 22px}.trend-empty-icon{width:42px;height:42px;color:#716755;margin-bottom:14px}.trend-empty h3{font-size:16px;font-weight:600;margin:0 0 7px}.trend-empty p{max-width:560px;margin:0;color:var(--muted);font-size:13px;line-height:1.55}
.grid{display:grid;gap:14px}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.card-pad{padding:18px}.card-title{font-weight:600;font-size:14px}.metric{font-size:29px;font-weight:650;letter-spacing:-.035em;margin-top:12px}.metric-note{font-size:12px;color:var(--muted);margin-top:4px}.section-title{display:flex;justify-content:space-between;align-items:center;margin:4px 0 10px}.section-title h2{font-size:16px;margin:0;font-weight:600}.section-title span{color:var(--muted);font-size:12px}.table-wrap{overflow:auto}.starts-table{min-width:680px}.table{width:100%;border-collapse:collapse}.table th{font-size:10px;text-transform:uppercase;letter-spacing:.07em;text-align:left;color:var(--muted);font-weight:650;padding:11px 14px;border-bottom:1px solid var(--line);background:#10100f}.table td{padding:13px 14px;border-bottom:1px solid #24221e}.table tr:last-child td{border-bottom:0}.entity-list{display:grid}.entity-row{width:100%;border:0;border-bottom:1px solid #25231e;background:transparent;color:var(--text);display:flex;align-items:center;justify-content:space-between;text-align:left;padding:15px 17px;cursor:pointer;margin:0}.entity-row:last-child{border-bottom:0}.entity-row:hover{background:#181714}.entity-name{font-weight:550}.chevron{color:#716c65;font-size:20px}.pager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px}.pager-meta{font-size:12px;color:var(--muted)}.pager-actions{display:flex;gap:8px}.pager-btn{border:1px solid var(--line);background:#141412;color:var(--text);border-radius:9px;padding:8px 12px;cursor:pointer}.pager-btn:disabled{opacity:.35;cursor:default}.empty{padding:34px 18px;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--text);font-size:15px;font-weight:600;margin-bottom:5px}.status-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--line)}.status-row:last-child{border-bottom:0}
.bottom-nav{position:fixed;z-index:50;left:0;right:0;bottom:0;background:rgba(11,11,10,.98);backdrop-filter:blur(18px);border-top:1px solid var(--line-soft);padding:8px max(10px,env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))}.bottom-inner{max-width:680px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.nav-item{border:0;background:transparent;color:#74706a;border-radius:11px;padding:8px 7px 7px;cursor:pointer;font-weight:550;font-size:11px;transition:background .15s,color .15s}.nav-icon{width:21px;height:21px;margin:0 auto 5px;display:block}.nav-item:hover{color:#aaa39a}.nav-item.active{color:var(--gold-soft);background:rgba(207,163,95,.075)}
.detail-head{display:grid;grid-template-columns:68px 1fr;gap:16px;align-items:center;margin-bottom:20px}.avatar{width:68px;height:68px;border-radius:16px;border:1px solid var(--line);background:linear-gradient(135deg,#24221e,#121210);display:grid;place-items:center;color:var(--gold-soft);font-weight:650;font-size:22px}.detail-name{font-size:27px;font-weight:650;letter-spacing:-.025em}.detail-meta{color:var(--muted);margin-top:4px}.back{border:1px solid var(--line);background:#121210;color:#aaa39a;border-radius:9px;padding:8px 12px;cursor:pointer;margin-bottom:20px}.back:hover{color:var(--text)}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden}.fact{background:var(--panel);padding:14px}.fact-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.fact-value{margin-top:5px;font-weight:550}.link{color:var(--gold-soft);cursor:pointer}.notice{border:1px solid #4b4235;background:#191610;padding:14px 15px;border-radius:12px;color:#c8beb0}.skeleton{height:80px;border-radius:14px;background:linear-gradient(90deg,#141412,#1d1c19,#141412);background-size:200% 100%;animation:pulse 1.3s infinite}@keyframes pulse{to{background-position:-200% 0}}
@media(max-width:760px){.shell{padding-bottom:86px}.top-inner{grid-template-columns:auto 1fr;padding:9px 11px;gap:11px}.brand-name{display:none}.brand-badge{width:34px;height:34px}.brand-icon{width:20px;height:20px}.logout{display:none}.search{height:42px;padding-left:67px;font-size:14px}.search-prefix{left:13px;gap:12px}.search-icon{width:19px;height:19px}.search-divider{height:20px}.main{padding:23px 13px}.page-heading,.start-heading{margin-bottom:20px}.page-heading h1,.start-heading h1{font-size:26px}.trend-filters{grid-template-columns:1fr;gap:16px}.segment-group,.range-group{flex-wrap:nowrap;overflow:auto;scrollbar-width:none;padding-bottom:1px}.segment-btn,.range-btn{white-space:nowrap}.trend-panel-head{padding:17px}.trend-empty{min-height:220px;padding:32px 17px}.grid-3,.grid-2{grid-template-columns:1fr}.facts{grid-template-columns:1fr}.tabs{gap:20px}.tab{padding-bottom:10px}.card-pad{padding:15px}.metric{font-size:27px}.entity-row{padding:15px 14px}.pager{align-items:flex-start;flex-direction:column}.pager-actions{width:100%}.pager-btn{flex:1}.detail-head{grid-template-columns:58px 1fr;gap:12px}.avatar{width:58px;height:58px;border-radius:14px;font-size:19px}.detail-name{font-size:24px}.bottom-nav{padding-top:6px}.nav-item{padding-top:7px}}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar"><div class="top-inner">
    ${brand()}
    <div class="search-wrap">
      <div class="search-shell">
        <span class="search-prefix">${icon('search', 'search-icon')}<span class="search-divider"></span></span>
        <input id="globalSearch" class="search" placeholder="Sök häst, tränare eller kusk…" autocomplete="off">
        <button id="clearSearch" class="search-clear" aria-label="Rensa sökning">${icon('close', 'clear-icon')}</button>
      </div>
      <div id="searchResults" class="search-results"></div>
    </div>
    <form method="post" action="/app/logout"><button class="logout" type="submit">Logga ut</button></form>
  </div></header>
  <main id="app" class="main"><div class="skeleton"></div></main>
  <nav class="bottom-nav" aria-label="Huvudnavigation"><div class="bottom-inner">
    <button class="nav-item active" data-page="start">${icon('trend', 'nav-icon')}Start</button>
    <button class="nav-item" data-page="trainers">${icon('trainer', 'nav-icon')}Tränare</button>
    <button class="nav-item" data-page="horses">${icon('horse', 'nav-icon')}Hästar</button>
    <button class="nav-item" data-page="drivers">${icon('driver', 'nav-icon')}Kuskar</button>
  </div></nav>
</div>
<script>
const app=document.getElementById('app');
const searchInput=document.getElementById('globalSearch');
const searchResults=document.getElementById('searchResults');
const PAGE_SIZE=20;
const state={page:'start',tab:'list',detail:null,cache:{},listOffsets:{trainers:0,horses:0,drivers:0},trendCategory:'trainers',trendRange:'4w'};
const labels={trainers:'Tränare',horses:'Hästar',drivers:'Kuskar'};
const singular={trainer:'Tränare',horse:'Häst',driver:'Kusk'};
const typeToPage={trainer:'trainers',horse:'horses',driver:'drivers'};
const sexLabels={mare:'Sto',gelding:'Valack',stallion:'Hingst',female:'Sto',male:'Hingst'};
const trendRanges={'2w':'2 veckor','4w':'4 veckor','3m':'3 mån','6m':'6 mån','1y':'1 år'};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function num(v){return new Intl.NumberFormat('sv-SE').format(Number(v||0))}
function money(v){return v==null?'—':new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',maximumFractionDigits:0}).format(v)}
function pct(v){return v==null?'—':new Intl.NumberFormat('sv-SE',{style:'percent',maximumFractionDigits:1}).format(v)}
function localSex(v){if(!v)return '—';return sexLabels[String(v).toLowerCase()]||v}
async function api(path){const r=await fetch('/app/api'+path,{headers:{accept:'application/json'}});if(r.status===401){location.href='/app/login';throw new Error('unauthorized')}if(!r.ok)throw new Error(await r.text());return r.json()}
function setNav(page){document.querySelectorAll('.nav-item').forEach(b=>{const active=b.dataset.page===page;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')})}
function heading(title,sub){return '<div class="page-heading"><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div>'}
function tabs(items,active){return '<div class="tabs">'+items.map(([id,label])=>'<button class="tab '+(id===active?'active':'')+'" data-tab="'+id+'">'+label+'</button>').join('')+'</div>'}
function empty(title,text){return '<div class="card"><div class="empty"><strong>'+esc(title)+'</strong>'+esc(text)+'</div></div>'}
function fact(label,value){return '<div class="fact"><div class="fact-label">'+esc(label)+'</div><div class="fact-value">'+esc(value??'—')+'</div></div>'}
function initials(name){return String(name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}
function trendControls(){const categories=[['trainers','Tränare'],['horses','Hästar'],['drivers','Kuskar']];const ranges=[['2w','2 veckor'],['4w','4 veckor'],['3m','3 mån'],['6m','6 mån'],['1y','1 år']];return '<div class="trend-filters"><div class="filter-block"><div class="filter-label">Kategori</div><div class="segment-group">'+categories.map(([id,label])=>'<button class="segment-btn '+(state.trendCategory===id?'active':'')+'" data-trend-category="'+id+'" aria-pressed="'+(state.trendCategory===id)+'">'+label+'</button>').join('')+'</div></div><div class="filter-block"><div class="filter-label">Tidsperiod</div><div class="range-group">'+ranges.map(([id,label])=>'<button class="range-btn '+(state.trendRange===id?'active':'')+'" data-trend-range="'+id+'" aria-pressed="'+(state.trendRange===id)+'">'+label+'</button>').join('')+'</div></div></div>'}
function bindTrendControls(){document.querySelectorAll('[data-trend-category]').forEach(b=>b.onclick=()=>{state.trendCategory=b.dataset.trendCategory;renderStart()});document.querySelectorAll('[data-trend-range]').forEach(b=>b.onclick=()=>{state.trendRange=b.dataset.trendRange;renderStart()})}
async function renderStart(){state.detail=null;state.page='start';setNav('start');const summary=state.cache.summary||await api('/summary');state.cache.summary=summary;const category=labels[state.trendCategory];const range=trendRanges[state.trendRange];const reason=summary.trends&&summary.trends.available?'Historiska resultat finns, men trendrankingen aktiveras först när underlaget är tillräckligt för en stabil jämförelse.':'Trendrankingen visas när tillräckligt många historiska resultat har importerats. Inga värden uppskattas eller fylls i i förväg.';app.innerHTML='<div class="start-heading"><h1>Trender</h1><p>Jämför utveckling för tränare, hästar och kuskar över valda tidsperioder.</p></div>'+trendControls()+'<section class="trend-panel"><div class="trend-panel-head"><div><div class="trend-panel-kicker">'+esc(category)+'</div><h2>Starkaste utvecklingen</h2></div><div class="period-badge">'+esc(range)+'</div></div><div class="trend-empty"><svg class="trend-empty-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1-8-8V48a8,8,0,0,1,16,0V156.69l50.34-50.35a8,8,0,0,1,11.32,0L128,132.69,180.69,80H160a8,8,0,0,1,0-16h40a8,8,0,0,1,8,8v40a8,8,0,0,1-16,0V91.31l-58.34,58.35a8,8,0,0,1-11.32,0L96,123.31l-56,56V200H224A8,8,0,0,1,232,208Z"/></svg><h3>Trenddata byggs upp</h3><p>'+esc(reason)+'</p></div></section>';bindTrendControls()}
function entityRows(items){return '<div class="card entity-list">'+items.map(item=>'<button class="entity-row" data-id="'+esc(item.id)+'"><span class="entity-name">'+esc(item.name)+'</span><span class="chevron">›</span></button>').join('')+'</div>'}
function pager(data){if(!data.total)return '';const from=data.offset+1;const to=Math.min(data.offset+data.items.length,data.total);return '<div class="pager"><div class="pager-meta">Visar '+num(from)+'–'+num(to)+' av '+num(data.total)+'</div><div class="pager-actions"><button class="pager-btn" id="prevPage" '+(data.offset===0?'disabled':'')+'>Föregående</button><button class="pager-btn" id="nextPage" '+(!data.hasMore?'disabled':'')+'>Nästa</button></div></div>'}
async function renderEntityList(page){state.detail=null;state.page=page;setNav(page);const offset=state.listOffsets[page]||0;const data=await api('/entities/'+page+'?limit='+PAGE_SIZE+'&offset='+offset);if(data.total>0&&!data.items.length&&offset>0){state.listOffsets[page]=Math.max(0,Math.floor((data.total-1)/data.limit)*data.limit);return renderEntityList(page)}app.innerHTML=heading(labels[page],'Sök och utforska '+labels[page].toLowerCase())+tabs([['list','Lista'],['stats','Statistik']],state.tab);if(state.tab==='list')app.innerHTML+=data.items.length?entityRows(data.items)+pager(data):empty('Inga poster att visa','Databasen har inga poster på den här sidan.');else app.innerHTML+=empty('Statistik byggs på resultatdata','Här kommer vinstprocent, starter, placeringar och utveckling över valda perioder när historiken finns.');bindTabs(()=>renderEntityList(page));document.querySelectorAll('.entity-row[data-id]').forEach(row=>row.onclick=()=>openDetail(page,row.dataset.id));const prev=document.getElementById('prevPage');const next=document.getElementById('nextPage');if(prev)prev.onclick=()=>{state.listOffsets[page]=Math.max(0,data.offset-data.limit);renderEntityList(page)};if(next)next.onclick=()=>{state.listOffsets[page]=data.offset+data.limit;renderEntityList(page)}}
function detailTabs(type){if(type==='horse')return [['overview','Översikt'],['starts','Starter'],['stats','Statistik'],['equipment','Utrustning']];return [['overview','Översikt'],['stats','Statistik'],['horses','Hästar'],['starts','Starter']]}
function startsTable(detail){const rows=detail.starts||[];if(!rows.length)return empty('Inga starter att visa','Databasen har ännu inga starter kopplade till denna profil.');return '<div class="card table-wrap"><table class="table starts-table"><thead><tr><th>Datum</th><th>Bana</th><th>Häst</th><th>Distans</th><th>Plac.</th><th>Km-tid</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.race_date||'—')+'</td><td>'+esc(r.track_name||'—')+'</td><td>'+esc(r.horse_name||detail.entity.name||'—')+'</td><td>'+esc(r.distance_m?num(r.distance_m)+' m':'—')+'</td><td>'+esc(r.placing_text||r.placing||'—')+'</td><td>'+esc(r.km_time||'—')+'</td></tr>').join('')+'</tbody></table></div>'}
async function openDetail(page,id){state.detail={page,id};state.page=page;state.tab='overview';setNav(page);await renderDetail()}
async function renderDetail(){const {page,id}=state.detail;const detail=await api('/entities/'+page+'/'+encodeURIComponent(id));const e=detail.entity;const type=detail.type;app.innerHTML='<button class="back" id="backBtn">← '+labels[page]+'</button><div class="detail-head"><div class="avatar">'+esc(initials(e.name))+'</div><div><div class="eyebrow">'+singular[type]+'</div><div class="detail-name">'+esc(e.name)+'</div><div class="detail-meta">'+esc(e.country_code||'')+'</div></div></div>'+tabs(detailTabs(type),state.tab);if(state.tab==='overview'){let facts='';if(type==='horse'){facts+=fact('Tränare',e.trainer_name||'—')+fact('Intjänat',money(e.career_earnings_sek))+fact('Kön',localSex(e.sex))+fact('Färg',e.color||'—')+fact('Far',e.sire_name||'—')+fact('Mor',e.dam_name||'—')+fact('Ägare',e.owner||'—')+fact('Uppfödare',e.breeder||'—')}else{facts+=fact('Hästar i databasen',num(detail.stats.linkedHorses))+fact('Starter i databasen',num(detail.stats.databaseStarts))+fact('Starter med resultat',num(detail.stats.resultStarts))+fact('Vinstprocent',pct(detail.stats.winRate));if(e.home_track_name)facts+=fact('Hemmabana',e.home_track_name);if(e.country_code)facts+=fact('Land',e.country_code)}app.innerHTML+='<div class="facts">'+facts+'</div>'}if(state.tab==='starts')app.innerHTML+=startsTable(detail);if(state.tab==='stats'){if(type==='horse')app.innerHTML+=empty('Statistik kommer med historiken','Vi visar inte härledda formtal förrän resultatunderlaget finns.');else app.innerHTML+='<div class="grid grid-3"><div class="card"><div class="card-pad"><div class="card-title">Starter med resultat</div><div class="metric">'+num(detail.stats.resultStarts)+'</div></div></div><div class="card"><div class="card-pad"><div class="card-title">Vinstprocent</div><div class="metric">'+pct(detail.stats.winRate)+'</div></div></div><div class="card"><div class="card-pad"><div class="card-title">Topp 3</div><div class="metric">'+pct(detail.stats.top3Rate)+'</div></div></div></div>'}if(state.tab==='equipment')app.innerHTML+=empty('Utrustningshistorik','Här kommer skor, sulky och förändringar när flera tidsstämplade observationer finns.');if(state.tab==='horses'){const seen=new Map();(detail.starts||[]).forEach(r=>{if(r.horse_id)seen.set(r.horse_id,r.horse_name)});app.innerHTML+=seen.size?'<div class="card"><div class="card-pad">'+Array.from(seen.entries()).map(([hid,name])=>'<div class="status-row"><span>'+esc(name)+'</span><span class="link" data-horse="'+esc(hid)+'">Öppna ›</span></div>').join('')+'</div></div>':empty('Inga hästar ännu','Ingen hästhistorik är kopplad till denna profil i databasen.')}document.getElementById('backBtn').onclick=()=>{state.detail=null;state.tab='list';renderEntityList(page)};bindTabs(renderDetail);document.querySelectorAll('[data-horse]').forEach(x=>x.onclick=()=>openDetail('horses',x.dataset.horse))}
function bindTabs(fn){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;fn()})}
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{if(b.dataset.page==='start'){renderStart()}else{state.tab='list';renderEntityList(b.dataset.page)}})
let searchTimer;searchInput.addEventListener('input',()=>{clearTimeout(searchTimer);const q=searchInput.value.trim();if(q.length<2){searchResults.classList.remove('open');return}searchTimer=setTimeout(async()=>{const items=await api('/search?q='+encodeURIComponent(q));searchResults.innerHTML=items.length?items.map(i=>'<div class="search-item" data-type="'+i.type+'" data-id="'+esc(i.id)+'"><span>'+esc(i.name)+'</span><span class="search-type">'+singular[i.type]+'</span></div>').join(''):'<div class="empty">Inga träffar</div>';searchResults.classList.add('open');searchResults.querySelectorAll('[data-id]').forEach(x=>x.onclick=()=>{searchResults.classList.remove('open');searchInput.value='';openDetail(typeToPage[x.dataset.type],x.dataset.id)})},180)});document.getElementById('clearSearch').onclick=()=>{searchInput.value='';searchResults.classList.remove('open');searchInput.focus()};document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))searchResults.classList.remove('open')});
renderStart().catch(err=>{app.innerHTML='<div class="notice">Kunde inte läsa data: '+esc(err.message)+'</div>'});
</script>
</body>
</html>`;
}

export function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers
    }
  });
}

export function safeReturnPath(value) {
  const path = String(value || '/app');
  return path.startsWith('/app') && !path.startsWith('//') ? path : '/app';
}

export function redirectResponse(location, headers = {}) {
  return new Response(null, { status: 303, headers: { location: escapeHtml(location), ...headers } });
}
