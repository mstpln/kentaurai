import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSystem, summarizeSystems, resultNet, selectionResult,
  resultFormSegments, formatSwedishNumber, formatSwedishMoney
} from '../src/phase1-model.js';
import {
  PHASE1_STORAGE_KEY, emptyPhase1Store, readPhase1Store, writePhase1Store,
  saveHorseNote, updateHorseNote, deleteHorseNote, saveLocalSystem
} from '../src/phase1-store.js';

const legs = count => Array.from({ length: 8 }, () => Array.from({ length: count }, (_, i) => i + 1));
const system = (overrides = {}) => ({
  roundId: 'synthetic-round', gameType: 'V85', legs: legs(2),
  stakeSek: 128, payoutSek: null, settlementState: 'pending', ...overrides
});

test('manual systems calculate eight-leg product and game-specific prices', () => {
  assert.equal(calculateSystem(legs(2), 'V85').rows, 256);
  assert.equal(calculateSystem(legs(2), 'V85').cost, 128);
  assert.equal(calculateSystem(legs(2), 'V86').cost, 64);
  assert.equal(calculateSystem(legs(15), 'V85').rows, 15 ** 8);
  assert.ok(Number.isSafeInteger(calculateSystem(legs(15), 'V85').rows));
});

test('incomplete systems never become one row; arbitrary spike counts are supported', () => {
  assert.equal(calculateSystem([]).rows, 0);
  const incomplete = legs(2);
  incomplete[3] = [];
  assert.equal(calculateSystem(incomplete).complete, false);
  assert.equal(calculateSystem(incomplete).rows, 0);
  assert.equal(calculateSystem(legs(1)).spikes, 8);
  assert.equal(calculateSystem(legs(2)).spikes, 0);
  const mixed = legs(2);
  mixed[0] = [15];
  mixed[6] = [1];
  assert.equal(calculateSystem(mixed).spikes, 2);
  assert.equal(calculateSystem(mixed).rows, 64);
});

test('selection changes immediately alter deterministic arithmetic', () => {
  const selections = legs(1);
  assert.equal(calculateSystem(selections).cost, 0.5);
  selections[0].push(15);
  assert.equal(calculateSystem(selections).rows, 2);
  assert.equal(calculateSystem(selections).cost, 1);
  selections[0].splice(0, 1);
  assert.equal(calculateSystem(selections).rows, 1);
});

test('financial totals exclude pending and incomplete settlements; zero payout is a real loss', () => {
  const data = [
    system({ settlementState: 'settled', stakeSek: 100, payoutSek: 0 }),
    system({ settlementState: 'settled', stakeSek: 200, payoutSek: 200 }),
    system({ settlementState: 'settled', stakeSek: 300, payoutSek: 600 }),
    system({ stakeSek: 9000, payoutSek: 99999 }),
    system({ settlementState: 'settled', stakeSek: 9000, payoutSek: null })
  ];
  const summary = summarizeSystems(data);
  assert.equal(summary.registeredCount, 5);
  assert.equal(summary.settledCount, 3);
  assert.equal(summary.stakeSek, 600);
  assert.equal(summary.payoutSek, 800);
  assert.equal(summary.netSek, 200);
  assert.equal(resultNet(0, 100), -100);
  assert.equal(resultNet(100, 100), 0);
  assert.equal(resultNet(200, 100), 100);
  for (const missing of [null, undefined, '', 'unknown']) assert.equal(resultNet(missing, 100), null);
});

test('covered legs do not imply payout; unknown winners remain neutral', () => {
  assert.equal(selectionResult([1, 15], 15), 'covered');
  assert.equal(selectionResult([1, 15], 2), 'missed');
  assert.equal(selectionResult([1, 15], null), 'pending');
  assert.equal(selectionResult(['1'], 1), 'covered');
  assert.equal(resultNet(null, 128), null);
});

test('form display preserves gallop versus disqualification and unknown codes', () => {
  assert.deepEqual(resultFormSegments('1'), [{ text: '1', kind: 'win' }]);
  assert.deepEqual(resultFormSegments('3G'), [
    { text: '3', kind: 'neutral' }, { text: 'G', kind: 'gallop' }
  ]);
  assert.deepEqual(resultFormSegments('GD'), [{ text: 'GD', kind: 'disqualified' }]);
  assert.deepEqual(resultFormSegments(null), []);
  assert.deepEqual(resultFormSegments('source-code'), [{ text: 'SOURCE-CODE', kind: 'neutral' }]);
});

test('numbers use Swedish formatting and missing measurements stay missing', () => {
  assert.equal(formatSwedishNumber(null), '–');
  assert.equal(formatSwedishMoney(null), '–');
  assert.equal(formatSwedishMoney(0.5, { currency: true }), '0,50 kr');
  assert.match(formatSwedishNumber(12500), /^12\s500$/);
});

test('horse notes create, edit and delete by stable horse identity', () => {
  const first = saveHorseNote(emptyPhase1Store(), { horseId: 'horse-a', text: '  Egen notering  ' }, '2026-11-08T12:00:00Z');
  assert.equal(first.ok, true);
  assert.equal(first.item.text, 'Egen notering');
  assert.equal(first.item.raceEntryId, null);
  const linked = saveHorseNote(first.value, {
    horseId: 'horse-b', text: 'Loppanknuten', raceEntryId: 'entry-b',
    context: { arbitraryRaceFacts: 'must not be duplicated in the note' }
  });
  assert.equal(linked.item.raceEntryId, 'entry-b');
  assert.ok(!linked.item.context, 'Historical facts are resolved through raceEntryId, not copied into the note');
  const edited = updateHorseNote(linked.value, first.item.id, { text: 'Redigerad', raceEntryId: null }, '2026-11-09T12:00:00Z');
  assert.equal(edited.ok, true);
  const note = edited.value.notes.find(item => item.id === first.item.id);
  assert.equal(note.horseId, 'horse-a');
  assert.equal(note.createdAt, '2026-11-08T12:00:00Z');
  assert.equal(note.updatedAt, '2026-11-09T12:00:00Z');
  const deleted = deleteHorseNote(edited.value, linked.item.id);
  assert.equal(deleted.value.notes.length, 1);
  assert.equal(deleted.value.notes[0].horseId, 'horse-a');
  assert.equal(saveHorseNote(first.value, { horseId: 'horse-a', text: ' ' }).ok, false);
  assert.equal(saveHorseNote(first.value, { horseId: '', text: 'x' }).ok, false);
  assert.equal(deleteHorseNote(first.value, 'not-found').ok, false);
});

test('local systems accept multiple registrations for one round but reject malformed selections', () => {
  const first = saveLocalSystem(emptyPhase1Store(), system());
  const second = saveLocalSystem(first.value, system());
  assert.equal(second.ok, true);
  assert.equal(second.value.systems.length, 2);
  assert.notEqual(second.value.systems[0].id, second.value.systems[1].id);
  for (const invalid of [[], legs(2).slice(1), [[], ...legs(1).slice(1)],
    [[16], ...legs(1).slice(1)], [[0], ...legs(1).slice(1)], [[1, 1], ...legs(1).slice(1)]]) {
    assert.equal(saveLocalSystem(emptyPhase1Store(), system({ legs: invalid })).ok, false);
  }
});

test('versioned local persistence survives reload without swallowing storage errors', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const value = saveHorseNote(emptyPhase1Store(), { horseId: 'horse-a', text: 'Delad notering' }).value;
  assert.equal(writePhase1Store(value, storage).ok, true);
  assert.deepEqual(readPhase1Store(storage).value, value);
  values.set(PHASE1_STORAGE_KEY, '{invalid-json');
  assert.equal(readPhase1Store(storage).ok, false);
  assert.equal(values.get(PHASE1_STORAGE_KEY), '{invalid-json');
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(readPhase1Store(denied).ok, false);
  assert.equal(writePhase1Store(value, denied).ok, false);
});
