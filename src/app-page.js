function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const logo = `
<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M12 45c4-14 12-25 25-31 4 2 8 5 11 9l7 3-3 8-8 2-6-4-8 6-3 12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M18 43c6-5 12-8 20-10M27 20l-5-6M34 16l1-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="43" cy="25" r="1.6" fill="currentColor"/>
</svg>`;

export function renderLoginPage({ error = false } = {}) {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>KentaurAI</title>
<style>
:root{--bg:#0d0d0c;--panel:#161614;--line:#2a2925;--text:#f4f0e8;--muted:#9d988f;--gold:#d6ab68;--brown:#5a4633;--blue:#4d6f95;--yellow:#e5c65c}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 15%,#242019 0,#0d0d0c 45%);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);padding:24px}.login{width:min(420px,100%);background:rgba(22,22,20,.92);border:1px solid var(--line);border-radius:24px;padding:28px;box-shadow:0 26px 70px rgba(0,0,0,.38)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:30px}.brand-mark{width:42px;height:42px;color:var(--gold)}.brand-name{font:600 28px/1 Georgia,serif;letter-spacing:-.02em}.brand-name span{color:var(--gold)}h1{font-size:21px;margin:0 0 6px}p{color:var(--muted);margin:0 0 22px}label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px}input{width:100%;border:1px solid var(--line);background:#0e0e0d;color:var(--text);border-radius:14px;padding:14px 15px;font:inherit;outline:none}input:focus{border-color:var(--gold)}button{width:100%;margin-top:14px;border:0;border-radius:14px;background:var(--gold);color:#17120d;padding:14px;font:700 15px inherit;cursor:pointer}.error{padding:10px 12px;border:1px solid #6d4b35;background:#2b1d16;color:#f2c7a9;border-radius:12px;margin-bottom:15px;font-size:13px}.note{font-size:12px;color:#777168;margin-top:18px}
</style>
</head>
<body>
<form class="login" method="post" action="/app/login" autocomplete="off">
  <div class="brand">${logo}<div class="brand-name">Kentaur<span>AI</span></div></div>
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
<meta name="theme-color" content="#0d0d0c">
<title>KentaurAI</title>
<style>
:root{--bg:#0d0d0c;--panel:#151513;--panel2:#1c1b18;--panel3:#23211d;--line:#2e2c27;--text:#f5f1e9;--muted:#969188;--muted2:#6f6b64;--gold:#d4aa67;--gold2:#f0cf91;--brown:#5b4634;--beige:#d8c7ae;--blue:#55769a;--yellow:#e4c65b;--danger:#c98263;--radius:18px;--shadow:0 16px 45px rgba(0,0,0,.25)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}.shell{min-height:100vh;padding-bottom:92px}.topbar{position:sticky;top:0;z-index:40;background:rgba(13,13,12,.94);backdrop-filter:blur(18px);border-bottom:1px solid rgba(46,44,39,.8)}.top-inner{max-width:1180px;margin:auto;padding:12px 18px;display:grid;grid-template-columns:auto minmax(180px,620px) auto;align-items:center;gap:16px}.brand{display:flex;align-items:center;gap:9px;min-width:max-content}.brand-mark{width:34px;height:34px;color:var(--gold)}.brand-name{font:600 21px/1 Georgia,serif;letter-spacing:-.02em}.brand-name span{color:var(--gold)}.search-wrap{position:relative}.search{width:100%;height:42px;border-radius:14px;border:1px solid var(--line);background:#171715;color:var(--text);padding:0 42px 0 42px;font:inherit;outline:none}.search:focus{border-color:#6a5944;background:#1a1917}.search-icon{position:absolute;left:14px;top:12px;color:var(--muted);font-size:17px}.search-clear{position:absolute;right:8px;top:7px;width:28px;height:28px;border:0;border-radius:9px;background:transparent;color:var(--muted);cursor:pointer;font-size:18px}.logout{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:11px;padding:8px 10px;cursor:pointer}.search-results{position:absolute;left:0;right:0;top:48px;background:#181816;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;display:none}.search-results.open{display:block}.search-item{display:flex;justify-content:space-between;gap:12px;padding:11px 13px;border-bottom:1px solid #26241f;cursor:pointer}.search-item:last-child{border-bottom:0}.search-item:hover{background:#211f1b}.search-type{color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.main{max-width:1180px;margin:auto;padding:24px 18px}.page-heading{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:20px}.page-heading h1{font-size:29px;letter-spacing:-.035em;margin:0}.page-heading p{margin:4px 0 0;color:var(--muted)}.eyebrow{color:var(--gold);font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:700}.tabs{display:flex;gap:5px;padding:4px;background:#171715;border:1px solid var(--line);border-radius:14px;width:max-content;max-width:100%;overflow:auto;margin-bottom:18px;scrollbar-width:none}.tab{border:0;background:transparent;color:var(--muted);padding:9px 15px;border-radius:10px;white-space:nowrap;font:600 13px inherit;cursor:pointer}.tab.active{background:var(--beige);color:#211b15}.grid{display:grid;gap:14px}.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.card-pad{padding:18px}.card-title{font-weight:700;font-size:15px}.card-sub{color:var(--muted);font-size:12px;margin-top:3px}.metric{font-size:30px;font-weight:750;letter-spacing:-.04em;margin-top:12px}.metric-note{font-size:12px;color:var(--muted);margin-top:3px}.accent-gold{border-top:2px solid var(--gold)}.accent-blue{border-top:2px solid var(--blue)}.accent-yellow{border-top:2px solid var(--yellow)}.section-title{display:flex;justify-content:space-between;align-items:center;margin:4px 0 10px}.section-title h2{font-size:16px;margin:0}.section-title span{color:var(--muted);font-size:12px}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;min-width:620px}.table th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;text-align:left;color:var(--muted);font-weight:650;padding:11px 14px;border-bottom:1px solid var(--line);background:#121210}.table td{padding:12px 14px;border-bottom:1px solid #27251f}.table tr:last-child td{border-bottom:0}.table tbody tr{cursor:pointer}.table tbody tr:hover{background:#1b1a17}.mono{font-variant-numeric:tabular-nums}.pill{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);font-size:12px}.empty{padding:32px 18px;text-align:center;color:var(--muted)}.empty strong{display:block;color:var(--text);font-size:15px;margin-bottom:5px}.status-list{display:grid;gap:9px}.status-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--line)}.status-row:last-child{border-bottom:0}.dot{width:8px;height:8px;border-radius:50%;background:var(--gold);display:inline-block;margin-right:8px}.dot.muted{background:var(--muted2)}.bottom-nav{position:fixed;z-index:50;left:0;right:0;bottom:0;background:rgba(13,13,12,.96);backdrop-filter:blur(18px);border-top:1px solid var(--line);padding:7px max(10px,env(safe-area-inset-right)) calc(7px + env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left))}.bottom-inner{max-width:650px;margin:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.nav-item{border:0;background:transparent;color:#74716c;border-radius:13px;padding:7px 5px 6px;cursor:pointer;font:600 11px inherit}.nav-icon{font-size:20px;line-height:1;margin-bottom:4px;display:block}.nav-item.active{color:var(--gold);background:#1b1916}.detail-head{display:grid;grid-template-columns:72px 1fr;gap:16px;align-items:center;margin-bottom:18px}.avatar{width:72px;height:72px;border-radius:18px;border:1px solid var(--line);background:linear-gradient(135deg,#2d2923,#151513);display:grid;place-items:center;color:var(--gold);font:700 25px Georgia,serif}.detail-name{font-size:27px;font-weight:750;letter-spacing:-.035em}.detail-meta{color:var(--muted);margin-top:4px}.back{border:1px solid var(--line);background:#171715;color:var(--text);border-radius:11px;padding:8px 12px;cursor:pointer;margin-bottom:18px}.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}.fact{background:var(--panel);padding:13px}.fact-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.fact-value{margin-top:4px;font-weight:650}.link{color:var(--gold);cursor:pointer}.notice{border:1px solid #514737;background:#1c1914;padding:14px 15px;border-radius:14px;color:#c9c0b2}.skeleton{height:80px;border-radius:16px;background:linear-gradient(90deg,#171715,#211f1b,#171715);background-size:200% 100%;animation:pulse 1.3s infinite}@keyframes pulse{to{background-position:-200% 0}}
@media(max-width:720px){.top-inner{grid-template-columns:auto 1fr;padding:10px 12px;gap:10px}.brand-name{display:none}.brand-mark{width:31px}.logout{display:none}.main{padding:18px 12px}.page-heading h1{font-size:25px}.grid-3,.grid-2{grid-template-columns:1fr}.facts{grid-template-columns:1fr}.tab{padding:8px 12px}.card-pad{padding:15px}.metric{font-size:27px}}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar"><div class="top-inner">
    <div class="brand">${logo}<div class="brand-name">Kentaur<span>AI</span></div></div>
    <div class="search-wrap"><span class="search-icon">⌕</span><input id="globalSearch" class="search" placeholder="Sök häst, tränare eller kusk…" autocomplete="off"><button id="clearSearch" class="search-clear" aria-label="Rensa">×</button><div id="searchResults" class="search-results"></div></div>
    <form method="post" action="/app/logout"><button class="logout" type="submit">Logga ut</button></form>
  </div></header>
  <main id="app" class="main"><div class="skeleton"></div></main>
  <nav class="bottom-nav"><div class="bottom-inner">
    <button class="nav-item active" data-page="start"><span class="nav-icon">⌂</span>Start</button>
    <button class="nav-item" data-page="trainers"><span class="nav-icon">◉</span>Tränare</button>
    <button class="nav-item" data-page="horses"><span class="nav-icon">♞</span>Hästar</button>
    <button class="nav-item" data-page="drivers"><span class="nav-icon">●</span>Kuskar</button>
  </div></nav>
</div>
<script>
const app=document.getElementById('app');
const searchInput=document.getElementById('globalSearch');
const searchResults=document.getElementById('searchResults');
const state={page:'start',tab:'overview',detail:null,cache:{}};
const labels={trainers:'Tränare',horses:'Hästar',drivers:'Kuskar'};
const singular={trainer:'Tränare',horse:'Häst',driver:'Kusk'};
const pageToType={trainers:'trainer',horses:'horse',drivers:'driver'};
const typeToPage={trainer:'trainers',horse:'horses',driver:'drivers'};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function num(v){return new Intl.NumberFormat('sv-SE').format(Number(v||0))}
function money(v){return v==null?'—':new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',maximumFractionDigits:0}).format(v)}
function pct(v){return v==null?'—':new Intl.NumberFormat('sv-SE',{style:'percent',maximumFractionDigits:1}).format(v)}
async function api(path){const r=await fetch('/app/api'+path,{headers:{accept:'application/json'}});if(r.status===401){location.href='/app/login';throw new Error('unauthorized')}if(!r.ok)throw new Error(await r.text());return r.json()}
function setNav(page){document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page))}
function heading(title,sub){return '<div class="page-heading"><div><div class="eyebrow">KentaurAI</div><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div></div>'}
function tabs(items,active){return '<div class="tabs">'+items.map(([id,label])=>'<button class="tab '+(id===active?'active':'')+'" data-tab="'+id+'">'+label+'</button>').join('')+'</div>'}
function empty(title,text){return '<div class="card"><div class="empty"><strong>'+esc(title)+'</strong>'+esc(text)+'</div></div>'}
async function renderStart(){state.detail=null;setNav('start');state.page='start';const summary=state.cache.summary||await api('/summary');state.cache.summary=summary;app.innerHTML=heading('Start','Databasöversikt och relevanta trender')+tabs([['overview','Översikt'],['trends','Trender'],['data','Datastatus']],state.tab);
 if(state.tab==='overview') app.innerHTML+='<div class="grid grid-3"><div class="card accent-gold"><div class="card-pad"><div class="card-title">Hästar</div><div class="metric">'+num(summary.counts.horses)+'</div><div class="metric-note">unika hästar i databasen</div></div></div><div class="card accent-blue"><div class="card-pad"><div class="card-title">Tränare</div><div class="metric">'+num(summary.counts.trainers)+'</div><div class="metric-note">unika tränare</div></div></div><div class="card accent-yellow"><div class="card-pad"><div class="card-title">Kuskar</div><div class="metric">'+num(summary.counts.drivers)+'</div><div class="metric-note">unika kuskar</div></div></div></div><div style="height:14px"></div><div class="card"><div class="card-pad"><div class="section-title"><h2>Databas just nu</h2><span>Läsbart underlag</span></div><div class="status-list"><div class="status-row"><span><i class="dot"></i>Lopp</span><strong>'+num(summary.counts.races)+'</strong></div><div class="status-row"><span><i class="dot"></i>Starter</span><strong>'+num(summary.counts.entries)+'</strong></div><div class="status-row"><span><i class="dot '+(summary.counts.results?'':'muted')+'"></i>Resultat</span><strong>'+num(summary.counts.results)+'</strong></div></div></div></div>';
 if(state.tab==='trends') app.innerHTML+=(summary.trends.available?'<div class="notice">Trenddata finns tillgänglig men första trendvyn byggs när historikunderlaget är tillräckligt stort.</div>':empty('Trender kommer senare',summary.trends.reason||'Historiska resultat saknas ännu.'));
 if(state.tab==='data') app.innerHTML+='<div class="grid grid-2"><div class="card"><div class="card-pad"><div class="card-title">Officiell live-data</div><div class="metric-note">Verifierad vertikal datakedja från råkälla till D1.</div></div></div><div class="card"><div class="card-pad"><div class="card-title">Historiska resultat</div><div class="metric-note">'+(summary.counts.results?'Resultatdata finns.':'Inte importerad ännu — därför visas inga påhittade trender.')+'</div></div></div></div>';
 bindTabs(renderStart)}
function entityRow(item){return '<tr data-id="'+esc(item.id)+'"><td><strong>'+esc(item.name)+'</strong></td><td class="mono">'+(item.external_id?esc(item.external_id):'—')+'</td><td>›</td></tr>'}
async function renderEntityList(page){state.detail=null;setNav(page);state.page=page;const data=await api('/entities/'+page);app.innerHTML=heading(labels[page],'Sök och utforska '+labels[page].toLowerCase())+tabs([['list','Lista'],['stats','Statistik']],state.tab);
 if(state.tab==='list') app.innerHTML+='<div class="card table-wrap"><table class="table"><thead><tr><th>Namn</th><th>Käll-ID</th><th></th></tr></thead><tbody>'+data.items.map(entityRow).join('')+'</tbody></table></div>';
 else app.innerHTML+=empty('Statistik byggs på resultatdata','Här kommer bland annat vinstprocent, starter, placeringar och utveckling över valda perioder när historiken finns.');
 bindTabs(()=>renderEntityList(page));document.querySelectorAll('tbody tr[data-id]').forEach(row=>row.onclick=()=>openDetail(page,row.dataset.id))}
function fact(label,value,raw=false){return '<div class="fact"><div class="fact-label">'+esc(label)+'</div><div class="fact-value">'+(raw?value:esc(value??'—'))+'</div></div>'}
function initials(name){return String(name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}
function detailTabs(type){if(type==='horse')return [['overview','Översikt'],['starts','Starter'],['stats','Statistik'],['equipment','Utrustning']];return [['overview','Översikt'],['stats','Statistik'],['horses','Hästar'],['starts','Starter']]}
function startsTable(detail){const rows=detail.starts||[];if(!rows.length)return empty('Inga starter att visa','Databasen har ännu inga starter kopplade till denna profil.');return '<div class="card table-wrap"><table class="table"><thead><tr><th>Datum</th><th>Bana</th><th>Häst</th><th>Distans</th><th>Plac.</th><th>Km-tid</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.race_date||'—')+'</td><td>'+esc(r.track_name||'—')+'</td><td>'+esc(r.horse_name||detail.entity.name||'—')+'</td><td>'+esc(r.distance_m?num(r.distance_m)+' m':'—')+'</td><td>'+esc(r.placing_text||r.placing||'—')+'</td><td>'+esc(r.km_time||'—')+'</td></tr>').join('')+'</tbody></table></div>'}
async function openDetail(page,id){state.detail={page,id};state.page=page;state.tab='overview';setNav(page);await renderDetail()}
async function renderDetail(){const {page,id}=state.detail;const detail=await api('/entities/'+page+'/'+encodeURIComponent(id));const e=detail.entity;const type=detail.type;app.innerHTML='<button class="back" id="backBtn">← '+labels[page]+'</button><div class="detail-head"><div class="avatar">'+esc(initials(e.name))+'</div><div><div class="eyebrow">'+singular[type]+'</div><div class="detail-name">'+esc(e.name)+'</div><div class="detail-meta">'+esc(e.country_code||'')+'</div></div></div>'+tabs(detailTabs(type),state.tab);
 if(state.tab==='overview'){let facts='';if(type==='horse'){facts+=fact('Tränare',e.trainer_name||'—')+fact('Intjänat',money(e.career_earnings_sek))+fact('Kön',e.sex)+fact('Färg',e.color)+fact('Far',e.sire_name)+fact('Mor',e.dam_name)+fact('Ägare',e.owner)+fact('Uppfödare',e.breeder)}else{facts+=fact('Land',e.country_code)+fact('Hemmabana',e.home_track_name)+(detail.stats?fact('Starter med resultat',num(detail.stats.starts))+fact('Vinstprocent',pct(detail.stats.winRate)):'')}app.innerHTML+='<div class="facts">'+facts+'</div>'}
 if(state.tab==='starts')app.innerHTML+=startsTable(detail);
 if(state.tab==='stats'){if(type==='horse')app.innerHTML+=empty('Statistik kommer med historiken','Vi visar inte härledda formtal förrän resultatunderlaget finns.');else app.innerHTML+='<div class="grid grid-3"><div class="card"><div class="card-pad"><div class="card-title">Starter</div><div class="metric">'+num(detail.stats.starts)+'</div></div></div><div class="card"><div class="card-pad"><div class="card-title">Vinstprocent</div><div class="metric">'+pct(detail.stats.winRate)+'</div></div></div><div class="card"><div class="card-pad"><div class="card-title">Topp 3</div><div class="metric">'+pct(detail.stats.top3Rate)+'</div></div></div></div>'}
 if(state.tab==='equipment')app.innerHTML+=empty('Utrustningshistorik','Här kommer skor, sulky och förändringar när flera tidsstämplade observationer finns.');
 if(state.tab==='horses'){const seen=new Map();(detail.starts||[]).forEach(r=>{if(r.horse_id)seen.set(r.horse_id,r.horse_name)});app.innerHTML+=seen.size?'<div class="card"><div class="card-pad">'+Array.from(seen.entries()).map(([hid,name])=>'<div class="status-row"><span>'+esc(name)+'</span><span class="link" data-horse="'+esc(hid)+'">Öppna ›</span></div>').join('')+'</div></div>':empty('Inga hästar ännu','Ingen hästhistorik är kopplad till denna profil i databasen.')}
 document.getElementById('backBtn').onclick=()=>{state.detail=null;state.tab='list';renderEntityList(page)};bindTabs(renderDetail);document.querySelectorAll('[data-horse]').forEach(x=>x.onclick=()=>openDetail('horses',x.dataset.horse))}
function bindTabs(fn){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;fn()})}
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{state.tab=b.dataset.page==='start'?'overview':'list';b.dataset.page==='start'?renderStart():renderEntityList(b.dataset.page)})
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
