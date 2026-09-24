import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestEnv } from './helpers/d1.js';
import { getFinalGameResult, parseFinalGameResultPayload, persistFinalGameResult } from '../src/game-final-result-v1.js';

function payload(type='V86') {
  const id=`${type}_2099-06-01_1_1`;
  return {
    id,
    status:'results',
    pools:{
      [type]:{
        status:'results',
        turnover:2448206800,
        systemCount:123456,
        result:{
          payouts:type==='V86'
            ? {
              8:{systems:14601,payout:43500},
              7:{systems:243467,jackpot:true},
              6:{systems:1768145,jackpot:true}
            }
            : {
              8:{systems:4,payout:123456700},
              7:{systems:81,payout:456700},
              6:{systems:902,payout:7800},
              5:{systems:4281,payout:2100}
            }
        }
      }
    }
  };
}

test('final game parser keeps exact raw payout units and derives SEK presentation values',()=>{
  const parsed=parseFinalGameResultPayload(payload('V86'));
  assert.equal(parsed.ready,true);
  assert.equal(parsed.gameType,'V86');
  assert.equal(parsed.turnoverRaw,2448206800);
  assert.equal(parsed.turnoverSek,24482068);
  assert.equal(parsed.highestPayoutLevel,8);
  assert.equal(parsed.highestPayoutRaw,43500);
  assert.equal(parsed.highestPayoutSek,435);
  assert.deepEqual(parsed.payouts[0],{level:8,payoutRaw:43500,payoutSek:435,systems:14601,jackpot:false});
  assert.deepEqual(parsed.payouts[1],{level:7,payoutRaw:null,payoutSek:null,systems:243467,jackpot:true});
});

test('final game parser supports V85 right levels generically',()=>{
  const parsed=parseFinalGameResultPayload(payload('V85'));
  assert.equal(parsed.ready,true);
  assert.equal(parsed.highestPayoutLevel,8);
  assert.equal(parsed.highestPayoutRaw,123456700);
  assert.equal(parsed.highestPayoutSek,1234567);
  assert.deepEqual(parsed.payouts.map(row=>row.level),[8,7,6,5]);
});

test('non-results game payload remains not ready and is not treated as final',()=>{
  const value=payload('V86');
  value.status='bettable';
  const parsed=parseFinalGameResultPayload(value);
  assert.equal(parsed.ready,false);
  assert.equal(parsed.status,'bettable');
});

test('persisted final result keeps provenance and raw plus normalized values',async()=>{
  const {env,db}=createTestEnv();
  const value=payload('V86');
  db.prepare(`INSERT INTO game_rounds (id,game_type,round_date,status) VALUES (?,'V86','2099-06-01','bettable')`).run(value.id);
  db.prepare(`INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status)
    VALUES ('src_final','official_provider',?,'2099-06-01T22:00:00Z','normalized_verified_subset')`).run('game:'+value.id);

  const stored=await persistFinalGameResult(env,value,{sourceRecordId:'src_final',capturedAt:'2099-06-01T22:00:00Z'});
  assert.equal(stored.highestPayoutRaw,43500);

  const row=await getFinalGameResult(env,value.id);
  assert.equal(row.sourceRecordId,'src_final');
  assert.equal(row.highestPayoutRaw,43500);
  assert.equal(row.highestPayoutSek,435);
  assert.equal(row.payouts['8'].payoutRaw,43500);
  assert.equal(row.payouts['8'].payoutSek,435);

  const round=db.prepare('SELECT status,turnover_sek,payout_json FROM game_rounds WHERE id=?').get(value.id);
  assert.equal(round.status,'results');
  assert.equal(round.turnover_sek,24482068);
  assert.equal(JSON.parse(round.payout_json)['8'].payoutRaw,43500);
});
