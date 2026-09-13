import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOfficialGamePayload } from '../src/import/official-live.js';
import { participantExternalId } from '../src/import/official-live-chunked.js';
import { v85V86GameIdsFromCalendar } from '../src/import/official-live-scheduled.js';

function gamePayload(startOverrides = {}) {
  const date = '2099-06-13';
  const races = Array.from({ length: 8 }, (_, raceIndex) => ({
    id: `${date}_990_${raceIndex + 1}`,
    date, number: raceIndex + 1, distance: 2100, startMethod: 'auto',
    track: { id: 990, name: 'Synthetic Nordic Track' },
    starts: [{ id: `source-start-${raceIndex + 1}`, number: 1, postPosition: 1, distance: 2100,
      horse: { name: `Synthetic Horse ${raceIndex + 1}` },
      driver: { id: 0, firstName: 'Declared', lastName: 'Driver' }, ...startOverrides }]
  }));
  return { id: 'V85_2099-06-13_990_1', status: 'scheduled', pools: { V85: { betType: 'V85' } }, races };
}

test('live game validation accepts declared starters without permanent horse id', () => {
  const validated = validateOfficialGamePayload(gamePayload());
  assert.equal(validated.gameId, 'V85_2099-06-13_990_1');
  assert.equal(validated.races.length, 8);
});
test('live game validation preserves strict boolean scratch semantics', () => {
  assert.doesNotThrow(() => validateOfficialGamePayload(gamePayload({ scratched: true })));
  assert.throws(() => validateOfficialGamePayload(gamePayload({ scratched: 'yes' })), /scratched must be boolean/);
});
test('participant placeholder identifiers are unavailable rather than canonical', () => {
  assert.equal(participantExternalId(null), null); assert.equal(participantExternalId(''), null);
  assert.equal(participantExternalId(0), null); assert.equal(participantExternalId('0'), null);
  assert.equal(participantExternalId(-4), null); assert.equal(participantExternalId(123), '123');
});
test('scheduled unpublished V85 placeholder is skipped neutrally', () => {
  const date = '2099-06-19';
  const ids = v85V86GameIdsFromCalendar({ date, games: { V85: [{ status: 'scheduled', races: [], track: { id: 991, name: 'Synthetic Track' } }] } }, date);
  assert.deepEqual(ids, []);
});
