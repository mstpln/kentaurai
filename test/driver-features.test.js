import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVER_LONGSHOT_PERCENT_MAX, isDriverLongshotPercent, verifiedHandicapBucket, voltLaneQuality } from '../src/statistics/driver-features.js';

test('canonical good volt lanes are 1, 6 and 7 within the current volt', () => {
  for (const actualLane of [1,6,7]) assert.equal(voltLaneQuality({startMethod:'volt',actualLane}), 'good');
  for (const actualLane of [2,3,4,5,8]) assert.equal(voltLaneQuality({startMethod:'volte',actualLane}), 'other');
  assert.equal(voltLaneQuality({startMethod:'auto',actualLane:1}), null);
  assert.equal(voltLaneQuality({startMethod:'volt',actualLane:null}), null);
});

test('verified handicap bucket stays separate from volt lane quality', () => {
  assert.equal(verifiedHandicapBucket({startMethod:'volt',handicapM:0,actualStartDistanceM:2140,raceDistanceM:2140}),0);
  assert.equal(verifiedHandicapBucket({startMethod:'volt',handicapM:20,actualStartDistanceM:2160,raceDistanceM:2140}),20);
  assert.equal(verifiedHandicapBucket({startMethod:'volt',handicapM:40,actualStartDistanceM:2180,raceDistanceM:2140}),40);
  assert.equal(verifiedHandicapBucket({startMethod:'volt',handicapM:20,actualStartDistanceM:2180,raceDistanceM:2140}),null);
  assert.equal(verifiedHandicapBucket({startMethod:'volt',handicapM:10,actualStartDistanceM:2150,raceDistanceM:2140}),null);
  assert.equal(verifiedHandicapBucket({startMethod:'auto',handicapM:0,actualStartDistanceM:2140,raceDistanceM:2140}),null);
});

test('longshot contract includes the exact five-percent boundary and rejects unknowns', () => {
  assert.equal(DRIVER_LONGSHOT_PERCENT_MAX,5);
  assert.equal(isDriverLongshotPercent(5),true);
  assert.equal(isDriverLongshotPercent(5.01),false);
  assert.equal(isDriverLongshotPercent(0),true);
  assert.equal(isDriverLongshotPercent(null),false);
  assert.equal(isDriverLongshotPercent(''),false);
});
