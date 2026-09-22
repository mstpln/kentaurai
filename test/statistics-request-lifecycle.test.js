import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderAppPage } from '../src/app-page.js';
import { enhanceHorseStatisticsHtml } from '../src/horse-statistics-ui.js';
import { enhanceDriverStatisticsHtml } from '../src/driver-statistics-ui.js';
import { enhanceTrainerStatisticsHtml } from '../src/trainer-statistics-ui.js';

class FakeClassList { add() {} remove() {} toggle() {} }
class FakeElement {
  constructor(document, id = '') { this.ownerDocument=document;this.id=id;this.dataset={};this.classList=new FakeClassList();this._innerHTML=''; }
  set innerHTML(value) { this._innerHTML=String(value);if(this.id==='app')this.ownerDocument.appWrites.push(this._innerHTML); }
  get innerHTML() { return this._innerHTML; }
  get textContent() { return ''; }
  set textContent(_value) {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
}
class FakeDocument {
  constructor() {
    this.appWrites=[];this.nodes=new Map();
    for(const id of ['app','globalSearch','searchResults','clearSearch'])this.nodes.set(id,new FakeElement(this,id));
  }
  getElementById(id) { return this.nodes.get(id)||new FakeElement(this,id); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
}

function abortError() { const error=new Error('aborted');error.name='AbortError';return error; }
function flush() { return new Promise((resolve)=>setImmediate(resolve)); }

function rankingRuntime({ ignoreAbort=false }={}) {
  const html=enhanceTrainerStatisticsHtml(enhanceDriverStatisticsHtml(enhanceHorseStatisticsHtml(renderAppPage())));
  const scripts=[...html.matchAll(/<script(?: id="[^"]+")?[^>]*>([\s\S]*?)<\/script>/g)].map((match)=>match[1]);
  const document=new FakeDocument();
  const requests=[];const frames=[];
  const context={
    document,console,URL,URLSearchParams,Intl,Date,Number,Map,Set,Promise,AbortController,
    encodeURIComponent,decodeURIComponent,Element:FakeElement,
    location:{href:'https://example.test/app/',pathname:'/app/',search:'',hash:''},
    history:{state:null,pushState(){},replaceState(){}},navigator:{},localStorage:{getItem(){return null},setItem(){},removeItem(){}},
    requestAnimationFrame(callback){frames.push(callback);return frames.length},
    setTimeout(callback,delay){if(!delay)callback();return 1},clearTimeout(){},addEventListener(){},
    fetch(url,options={}){
      const path=String(url).replace(/^\/app\/api/,'');
      let resolveRequest,rejectRequest;
      const promise=new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject});
      const request={path,options,resolve(data){resolveRequest({ok:true,status:200,json:async()=>data,text:async()=>''})},reject:rejectRequest};
      requests.push(request);
      if(options.signal&&!ignoreAbort)options.signal.addEventListener('abort',()=>rejectRequest(abortError()),{once:true});
      return promise;
    }
  };
  context.window=context;context.globalThis=context;
  const vmContext=vm.createContext(context);
  for(const source of scripts)new vm.Script(source).runInContext(vmContext);
  return {context:vmContext,document,requests,frames};
}

const horseCore={partial:true,rankings:{highestWinRate:[],highestTop3Rate:[],bestFormLast10:[]}};
const horseExtended={partial:false,rankings:{fastestFirst200:[],highestEarningsPerStart:[],strongestLast400:[],firstAfterRest:[],secondAfterRest:[],highestStartPoints:[]}};
const personCore={partial:true,definitions:{},rankings:{highestWinRate:[],highestTop3Rate:[],mostWins:[],bestFormLast30:[]}};

test('ranking core paints before extended is requested', async () => {
  const runtime=rankingRuntime();
  vm.runInContext("state.tab='stats'",runtime.context);
  const rendering=vm.runInContext("renderEntityList('horses')",runtime.context);
  assert.equal(runtime.requests.length,1);
  assert.match(runtime.requests[0].path,/mode=core/);
  runtime.requests[0].resolve(horseCore);
  await flush();
  assert.match(runtime.document.appWrites.at(-1),/Läser resterande statistik/);
  assert.equal(runtime.requests.length,1,'extended must not start before the post-core paint boundary');
  runtime.frames.shift()();
  await flush();
  assert.equal(runtime.requests.length,2);
  assert.match(runtime.requests[1].path,/mode=extended/);
  runtime.requests[1].resolve(horseExtended);
  await rendering;
  assert.doesNotMatch(runtime.document.appWrites.at(-1),/Läser resterande statistik/);
});

test('category, tab and filter changes abort the previous ranking lifecycle', async () => {
  const runtime=rankingRuntime();
  vm.runInContext("state.tab='stats'",runtime.context);
  const horse=vm.runInContext("renderEntityList('horses')",runtime.context);
  const horseSignal=runtime.requests[0].options.signal;
  const trainer=vm.runInContext("renderEntityList('trainers')",runtime.context);
  assert.equal(horseSignal.aborted,true,'category switch must abort horse statistics');
  await horse;
  const trainerSignal=runtime.requests[1].options.signal;
  vm.runInContext("state.tab='list';renderEntityList('trainers')",runtime.context);
  assert.equal(trainerSignal.aborted,true,'tab switch must abort trainer statistics');
  await trainer;
  runtime.requests[2].resolve({items:[],total:0,offset:0,limit:20,hasMore:false});
  await flush();

  vm.runInContext("state.tab='stats'",runtime.context);
  const firstFilter=vm.runInContext("renderEntityList('horses')",runtime.context);
  const firstFilterSignal=runtime.requests[3].options.signal;
  const secondFilter=vm.runInContext("state.horseStatsFilters.period='6m';renderEntityList('horses')",runtime.context);
  assert.equal(firstFilterSignal.aborted,true,'filter change must abort the previous request');
  await firstFilter;
  vm.runInContext('cancelRankingLifecycle()',runtime.context);
  await secondFilter;
  assert.doesNotMatch(runtime.document.appWrites.at(-1),/Kunde inte läsa (häst|tränar|kusk)statistik/);
});

test('abort-resistant stale results cannot repaint the current category', async () => {
  const runtime=rankingRuntime({ignoreAbort:true});
  vm.runInContext("state.tab='stats'",runtime.context);
  const horse=vm.runInContext("renderEntityList('horses')",runtime.context);
  const trainer=vm.runInContext("renderEntityList('trainers')",runtime.context);
  runtime.requests[0].resolve(horseCore);
  await horse;
  assert.equal(runtime.requests.filter((request)=>request.path.startsWith('/horses/statistics')).length,1,'stale horse core must not schedule extended');
  assert.match(runtime.document.appWrites.at(-1),/Tränare/);
  runtime.requests[1].resolve(personCore);
  await flush();
  assert.match(runtime.document.appWrites.at(-1),/Tränare/);
  vm.runInContext('cancelRankingLifecycle()',runtime.context);
  runtime.frames.shift()();
  await trainer;
});

test('extended failure preserves rendered core and abort remains silent', async () => {
  const runtime=rankingRuntime();
  vm.runInContext("state.tab='stats'",runtime.context);
  const rendering=vm.runInContext("renderEntityList('drivers')",runtime.context);
  runtime.requests[0].resolve(personCore);
  await flush();
  const coreHtml=runtime.document.appWrites.at(-1);
  runtime.frames.shift()();
  await flush();
  runtime.requests[1].reject(new Error('extended failed'));
  await rendering;
  assert.equal(runtime.document.appWrites.at(-1),coreHtml);
  assert.doesNotMatch(runtime.document.appWrites.at(-1),/Kunde inte läsa kuskstatistik/);
});
