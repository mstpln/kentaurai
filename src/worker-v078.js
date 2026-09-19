import worker from './worker-v077.js';
import { appAuthConfigured, hasValidAppSession } from './app-auth.js';
import {
  buildStep3Context,
  buildExternalEvidenceImportContext,
  getHorseExternalStatistics,
  getExternalInterviews,
  getStep3Prompt,
  getExternalEvidenceImportPrompt
} from './external-evidence-context-v1.js';
import { importExternalEvidence } from './external-evidence-model-v1.js';
import { enhanceExternalEvidenceUiHtml } from './app-external-evidence-v1.js';

export const EXTERNAL_EVIDENCE_WORKFLOW_VERSION = 'external-evidence-v1';

function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}
  });
}
function attachment(data,filename){return json(data,200,{'content-disposition':'attachment; filename="'+filename+'"'});}
async function requireSession(request,env){
  if(!appAuthConfigured(env)) return json({error:'service_unavailable'},503);
  if(!(await hasValidAppSession(request,env))) return json({error:'unauthorized'},401);
  return null;
}
async function readJson(request,maxBytes=5*1024*1024){
  const type=String(request.headers.get('content-type')||'').toLowerCase();
  if(!type.startsWith('application/json')) throw new Error('content-type must be application/json');
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes) throw new Error('JSON body is too large');
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>maxBytes) throw new Error('JSON body is too large');
  let value;try{value=JSON.parse(text)}catch{throw new Error('request body must be valid JSON')}
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('request body must be a JSON object');
  return value;
}
function safe(value){return String(value||'').replace(/[^a-zA-Z0-9._-]+/g,'_');}
async function enhanceApp(request,response){
  if(request.method!=='GET'||new URL(request.url).pathname!=='/app/') return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html')) return response;
  const headers=new Headers(response.headers);headers.delete('content-length');
  return new Response(enhanceExternalEvidenceUiHtml(await response.text()),{status:response.status,statusText:response.statusText,headers});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;

    if(path.startsWith('/app/api/')&&(
      path.includes('/external-step3')||
      path.includes('/external-evidence')||
      /\/entities\/(horses|trainers)\/[^/]+\/(external-statistics|interviews)$/.test(path)
    )){
      const denied=await requireSession(request,env);if(denied)return denied;
    }

    try{
      if(request.method==='GET'&&path==='/app/api/settings/external-step3-context'){
        const roundId=String(url.searchParams.get('round_id')||'').trim();if(!roundId)throw new Error('round_id is required');
        return attachment(await buildStep3Context(env,roundId),'kentaurai-external-context_'+safe(roundId)+'.json');
      }
      if(request.method==='GET'&&path==='/app/api/settings/external-step3-prompt'){
        return json({prompt_version:'external-evidence-prompt-v1',prompt:getStep3Prompt(url.searchParams.get('provider')||'openai')});
      }
      if(request.method==='GET'&&path==='/app/api/settings/external-evidence-import-context'){
        const roundId=String(url.searchParams.get('round_id')||'').trim();if(!roundId)throw new Error('round_id is required');
        return attachment(await buildExternalEvidenceImportContext(env,roundId),'kentaurai-external-import_'+safe(roundId)+'.json');
      }
      if(request.method==='GET'&&path==='/app/api/settings/external-evidence-import-prompt'){
        return json({prompt_version:'external-evidence-prompt-v1',prompt:getExternalEvidenceImportPrompt(url.searchParams.get('provider')||'openai')});
      }
      if(request.method==='POST'&&path==='/app/api/settings/external-evidence-import'){
        const roundId=String(url.searchParams.get('round_id')||'').trim();if(!roundId)throw new Error('round_id is required');
        const payload=await readJson(request);
        if(String(payload.round_id||'')!==roundId) throw new Error('payload round_id must match selected round');
        const result=await importExternalEvidence(env,payload);
        return json(result,result.reused?200:201);
      }

      let match=path.match(/^\/app\/api\/entities\/horses\/([^/]+)\/external-statistics$/);
      if(request.method==='GET'&&match){
        const data=await getHorseExternalStatistics(env,decodeURIComponent(match[1]));
        return data?json(data):json({error:'not_found'},404);
      }
      match=path.match(/^\/app\/api\/entities\/(horses|trainers)\/([^/]+)\/interviews$/);
      if(request.method==='GET'&&match){
        const data=await getExternalInterviews(env,match[1],decodeURIComponent(match[2]));
        return data?json(data):json({error:'not_found'},404);
      }
    }catch(error){
      console.error(error);
      return json({error:'request_failed',message:error.message},400);
    }

    return enhanceApp(request,await worker.fetch(request,env,ctx));
  },
  async scheduled(controller,env,ctx){return worker.scheduled(controller,env,ctx);}
};
