import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWinnerGroups } from '../src/routes/game-statistics.js';

test('winner index compares winner share with starter share for each group', () => {
  const labels=['A','B'];
  const rows=[
    { bucket:'A', placing:1 },
    { bucket:'A', placing:2 },
    { bucket:'A', placing:3 },
    { bucket:'A', placing:4 },
    { bucket:'B', placing:1 },
    { bucket:'B', placing:1 }
  ];
  const result=aggregateWinnerGroups(rows,labels,row=>row.bucket);
  const a=result.find(row=>row.label==='A');
  const b=result.find(row=>row.label==='B');

  assert.equal(a.starters,4);
  assert.equal(a.winners,1);
  assert.equal(a.winRate,0.25);
  assert.equal(a.winnerIndex,0.5);

  assert.equal(b.starters,2);
  assert.equal(b.winners,2);
  assert.equal(b.winRate,1);
  assert.equal(b.winnerIndex,2);
});

test('winner index remains null when no winner share can be established', () => {
  const result=aggregateWinnerGroups(
    [{ bucket:'A', placing:2 },{ bucket:'A', placing:3 }],
    ['A','B'],
    row=>row.bucket
  );
  assert.equal(result[0].winnerIndex,null);
  assert.equal(result[1].winnerIndex,null);
});
