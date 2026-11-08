export const PHASE1_LINE_PRICES = Object.freeze({ V85: 0.5, V86: 0.25 });

export function calculateSystem(legs, gameType = 'V85') {
  const type = String(gameType || '').toUpperCase();
  const selections = Array.from({ length: 8 }, (_, index) => {
    const leg = legs?.[index];
    return Array.isArray(leg) ? leg.length : Array.isArray(leg?.selections) ? leg.selections.length : 0;
  });
  const complete = selections.every((count) => count > 0);
  const rows = complete ? selections.reduce((total, count) => total * count, 1) : 0;
  const linePrice = PHASE1_LINE_PRICES[type] ?? null;
  return {
    complete,
    selections,
    rows,
    spikes: selections.filter((count) => count === 1).length,
    linePrice,
    cost: complete && linePrice != null ? rows * linePrice : null
  };
}

export function formatSwedishNumber(value, maximumFractionDigits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '–';
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits }).format(Number(value));
}

export function formatSwedishMoney(value, { currency = false } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '–';
  const amount = new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(Number(value));
  return currency ? `${amount} kr` : amount;
}

export function resultNet(payout, stake) {
  const missing = (value) => value == null || (typeof value === 'string' && (!value.trim() || value.trim().toLowerCase() === 'unknown'));
  if (missing(payout) || missing(stake) || !Number.isFinite(Number(payout)) || !Number.isFinite(Number(stake))) return null;
  return Number(payout) - Number(stake);
}

export function summarizeSystems(systems = []) {
  const knownNumber = (value) => value != null && !(typeof value === 'string' && (!value.trim() || value.trim().toLowerCase() === 'unknown')) && Number.isFinite(Number(value));
  const settled = systems.filter((system) =>
    system.settlementState === 'settled' &&
    knownNumber(system.payoutSek) &&
    knownNumber(system.stakeSek)
  );
  const stake = systems.reduce((total, system) => total + (knownNumber(system.stakeSek) ? Number(system.stakeSek) : 0), 0);
  const settledStake = settled.reduce((total, system) => total + Number(system.stakeSek), 0);
  const payout = settled.reduce((total, system) => total + Number(system.payoutSek || 0), 0);
  return {
    registeredCount: systems.length,
    settledCount: settled.length,
    stakeSek: stake,
    payoutSek: payout,
    netSek: settled.length ? resultNet(payout, settledStake) : null,
    pendingCount: systems.length - settled.length
  };
}

export function selectionResult(selectedNumbers = [], winningNumber = null) {
  if (winningNumber == null || (typeof winningNumber === 'string' && (!winningNumber.trim() || winningNumber.trim().toLowerCase() === 'unknown')) || !Number.isFinite(Number(winningNumber))) return 'pending';
  return selectedNumbers.map(Number).includes(Number(winningNumber)) ? 'covered' : 'missed';
}

export function resultFormSegments(value) {
  if (value == null || value === '') return [];
  const text = String(value).trim().toUpperCase();
  if (text === 'GD') return [{ text: 'GD', kind: 'disqualified' }];
  const match = text.match(/^(\d+)(G)?$/);
  if (!match) return [{ text, kind: 'neutral' }];
  const segments = [{ text: match[1], kind: match[1] === '1' ? 'win' : 'neutral' }];
  if (match[2]) segments.push({ text: 'G', kind: 'gallop' });
  return segments;
}

// Only normalize independently known result flags. Unknown provider codes are
// preserved rather than interpreted as gallop or disqualification.
export function displayStartResult(start) {
  if (!start) return null;
  const gallop = start.gallop === true || start.gallop === 1;
  const disqualified = start.disqualified === true || start.disqualified === 1;
  if (disqualified && gallop) return 'GD';
  if (disqualified) return start.placing_text || null;
  if (start.placing != null && start.placing !== '' && Number.isFinite(Number(start.placing))) {
    return String(start.placing) + (gallop ? 'G' : '');
  }
  const label = start.placing_text ?? start.placing;
  return label == null || label === '' ? null : String(label);
}
