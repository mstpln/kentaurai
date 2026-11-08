export const PHASE1_STORAGE_KEY = 'kentaurai.phase1.local.v1';
export const PHASE1_STORAGE_VERSION = 1;

export function emptyPhase1Store() {
  return { version: PHASE1_STORAGE_VERSION, notes: [], systems: [] };
}

function validStore(value) {
  return Boolean(value && value.version === PHASE1_STORAGE_VERSION &&
    Array.isArray(value.notes) && Array.isArray(value.systems));
}

export function readPhase1Store(storage = globalThis.localStorage) {
  try {
    if (!storage) throw new Error('Lokal lagring är inte tillgänglig i den här webbläsaren.');
    const raw = storage.getItem(PHASE1_STORAGE_KEY);
    if (!raw) return { ok: true, value: emptyPhase1Store() };
    const value = JSON.parse(raw);
    if (!validStore(value)) throw new Error('Lokal lagring har ett okänt format. Inga data har ändrats.');
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value: emptyPhase1Store(), error: error?.message || 'Kunde inte läsa lokal lagring.' };
  }
}

export function writePhase1Store(value, storage = globalThis.localStorage) {
  try {
    if (!storage) throw new Error('Lokal lagring är inte tillgänglig i den här webbläsaren.');
    if (!validStore(value)) throw new Error('Lokal data har ett ogiltigt format.');
    storage.setItem(PHASE1_STORAGE_KEY, JSON.stringify(value));
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value, error: error?.message || 'Kunde inte spara lokalt.' };
  }
}

function localId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function saveHorseNote(store, { horseId, text, raceEntryId = null, context = null }, now = new Date().toISOString()) {
  const body = String(text || '').trim();
  if (!String(horseId || '').trim()) return { ok: false, error: 'Häst-ID saknas.' };
  if (!body) return { ok: false, error: 'Skriv en anteckning innan du sparar.' };
  const note = {
    id: localId('note'),
    horseId: String(horseId),
    raceEntryId: raceEntryId == null || raceEntryId === '' ? null : String(raceEntryId),
    text: body,
    createdAt: now,
    updatedAt: now
  };
  return { ok: true, value: { ...store, notes: [note, ...store.notes] }, item: note };
}

export function updateHorseNote(store, noteId, changes, now = new Date().toISOString()) {
  const text = String(changes?.text || '').trim();
  if (!text) return { ok: false, error: 'Skriv en anteckning innan du sparar.' };
  let found = false;
  const notes = store.notes.map((note) => {
    if (note.id !== noteId) return note;
    found = true;
    const { context: _context, ...storedNote } = note;
    return {
      ...storedNote,
      text,
      raceEntryId: changes.raceEntryId == null || changes.raceEntryId === '' ? null : String(changes.raceEntryId),
      updatedAt: now
    };
  });
  return found ? { ok: true, value: { ...store, notes } } : { ok: false, error: 'Anteckningen kunde inte hittas.' };
}

export function deleteHorseNote(store, noteId) {
  const notes = store.notes.filter((note) => note.id !== noteId);
  return notes.length === store.notes.length
    ? { ok: false, error: 'Anteckningen kunde inte hittas.' }
    : { ok: true, value: { ...store, notes } };
}

export function saveLocalSystem(store, system) {
  if (!system?.roundId || !Array.isArray(system.legs) || system.legs.length !== 8) {
    return { ok: false, error: 'Systemet måste ha en omgång och åtta avdelningar.' };
  }
  if (system.legs.some((leg) => !Array.isArray(leg) || leg.length === 0)) {
    return { ok: false, error: 'Välj minst en häst i varje avdelning.' };
  }
  if (system.legs.some((leg) => {
    const values = leg.map(Number);
    return values.some((value) => !Number.isInteger(value) || value < 1 || value > 15) ||
      new Set(values).size !== values.length;
  })) {
    return { ok: false, error: 'Varje avdelning måste innehålla unika nummer mellan 1 och 15.' };
  }
  const item = { ...system, id: localId('system') };
  return { ok: true, value: { ...store, systems: [item, ...store.systems] }, item };
}

export function deleteLocalSystem(store, systemId) {
  const systems = store.systems.filter((system) => system.id !== systemId);
  return systems.length === store.systems.length
    ? { ok: false, error: 'Systemet kunde inte hittas.' }
    : { ok: true, value: { ...store, systems } };
}
