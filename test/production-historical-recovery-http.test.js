import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPrivateRecoveryJson } from '../scripts/private-recovery-http.mjs';

const ENDPOINT='https://synthetic.example.test/v1/storage-cleanup/restoration/run/scan-step';
const TOKEN='synthetic-temporary-cleanup-token-not-a-secret';
const response=(status,body={})=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'}
});

test('private recovery retries only transient 401 on an identical guarded POST',async()=>{
  const calls=[];
  let attempts=0;
  const waits=[];
  const result=await fetchPrivateRecoveryJson({
    url:ENDPOINT,token:TOKEN,method:'POST',body:{run_id:'synthetic-run'},
    fetchImpl:async (url,options)=>{
      calls.push({url,...options});
      attempts++;
      return attempts<3?response(401,{error:'unauthorized'}):
        response(200,{mode:'historical_provenance_recovery',phase:'inventory'});
    },
    sleep:async ms=>{waits.push(ms);}
  });
  assert.equal(attempts,3);
  assert.deepEqual(waits,[2500,2500]);
  assert.equal(result.phase,'inventory');
  for(const c of calls){
    assert.equal(c.url,ENDPOINT);
    assert.equal(c.redirect,'error');
    assert.equal(c.method,'POST');
    assert.equal(c.headers.authorization,'Bearer '+TOKEN);
    assert.equal(c.headers['content-type'],'application/json');
    assert.equal(c.body,'{"run_id":"synthetic-run"}');
  }
});

test('persistent unauthorized recovery calls fail without credential fallback',async()=>{
  let calls=0,waits=0;
  await assert.rejects(fetchPrivateRecoveryJson({
    url:ENDPOINT,token:TOKEN,
    fetchImpl:async()=>{calls++;return response(401,{error:'unauthorized'});},
    sleep:async()=>{waits++;}
  }),/recovery_private_api_authorization_failed/);
  assert.equal(calls,10);
  assert.equal(waits,9);
});

test('403, 409, 500 and redirects never retry or expose response bodies',async()=>{
  for(const status of [302,403,409,500]){
    let calls=0;
    await assert.rejects(fetchPrivateRecoveryJson({
      url:ENDPOINT,token:TOKEN,
      fetchImpl:async()=>{calls++;return response(status,{private:'do-not-log'});},
      sleep:async()=>{throw new Error('must_not_retry');}
    }),error=>{
      assert.equal(error.message,'recovery_private_api_http_'+status);
      assert.doesNotMatch(error.message,/do-not-log|synthetic-temporary/);
      return true;
    });
    assert.equal(calls,1);
  }
});

test('uncertain transport errors are redacted and are never replayed',async()=>{
  let calls=0;
  await assert.rejects(fetchPrivateRecoveryJson({
    url:ENDPOINT,token:TOKEN,method:'POST',body:{some:'synthetic'},
    fetchImpl:async()=>{
      calls++;
      throw new Error('untrusted error with token '+TOKEN);
    },
    sleep:async()=>{throw new Error('must_not_retry');}
  }),error=>{
    assert.equal(error.message,'recovery_private_api_transport_unavailable');
    return true;
  });
  assert.equal(calls,1);
});

test('missing token, HTTP URL and malformed JSON fail without unsafe fallback',async()=>{
  let calls=0;
  await assert.rejects(fetchPrivateRecoveryJson({
    url:ENDPOINT,token:'',fetchImpl:async()=>{calls++;return response(200);}
  }),/recovery_private_api_transport_not_configured/);
  await assert.rejects(fetchPrivateRecoveryJson({
    url:'http://synthetic.example.test/route',token:TOKEN,
    fetchImpl:async()=>{calls++;return response(200);}
  }),/recovery_private_api_transport_not_configured/);
  await assert.rejects(fetchPrivateRecoveryJson({
    url:ENDPOINT,token:TOKEN,fetchImpl:async()=>{
      calls++;
      return new Response('not json',{status:200});
    }
  }),/recovery_private_api_invalid_json/);
  assert.equal(calls,1);
});
